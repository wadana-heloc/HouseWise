from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

# These imports resolve via the sys.path shim in backend/app/main.py.
# They are imported at module load so the server fails fast if the AI
# team breaks any of these function signatures.
from cookbook_agent import generate_recipe, personalize_recipe_description
from recipe_photo_agent import extract_recipe_from_image

from ..auth.deps import CurrentUser, current_user, require_role
from ..auth.schemas import OkResponse
from ..supabase_client import get_supabase
from .schemas import (
    ExtractPhotoRequest,
    GenerateRecipeRequest,
    PersonalizedDescription,
    RecipeCreate,
    RecipeList,
    RecipeOut,
    RecipePreview,
    RecipeSource,
    RecipeStatus,
    RecipeUpdate,
)

# Last N reactions to feed `personalize_recipe_description` as `recent_history`.
# The agent's prompt is bounded; 5 is enough signal without bloating the call.
_DESCRIPTION_HISTORY_LIMIT = 5

router = APIRouter(prefix="/cookbook", tags=["cookbook"])


def _caller_household(sb, user_id: str) -> tuple[str, str]:
    """Return (household_id, role) for the caller. 403 if not in a household."""
    row = sb.table("users").select("household_id, role").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"], row.data.get("role") or ""


def _fetch_recipe_for_caller(
    sb, recipe_id: str, household_id: str, caller_id: str, caller_role: str
) -> dict:
    """Fetch a recipe enforcing the visibility rule: must be in household,
    AND either approved or submitted-by-caller or caller-is-admin.
    """
    res = (
        sb.table("recipes")
        .select("*")
        .eq("id", recipe_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    row = res.data[0]
    if (
        row["status"] != "approved"
        and row.get("submitted_by") != caller_id
        and caller_role != "admin"
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return row


def _insert_recipe(sb, payload: dict) -> dict:
    res = sb.table("recipes").insert(payload).execute()
    if not res.data:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Recipe insert returned no row")
    return res.data[0]


def _household_members_for_agent(sb, household_id: str) -> list[dict[str, Any]]:
    """Shape the household roster the way the AI agents expect.

    `age_group` and `taste_preferences` are passed as None because those
    columns don't exist in our schema; the agents must handle missing
    values gracefully.
    """
    res = (
        sb.table("users")
        .select("display_name, health_preferences")
        .eq("household_id", household_id)
        .execute()
    )
    return [
        {
            "display_name": m["display_name"],
            "age_group": None,
            "taste_preferences": None,
            "health_preferences": m.get("health_preferences") or {},
        }
        for m in (res.data or [])
    ]


@router.get(
    "/recipes",
    response_model=RecipeList,
    summary="List recipes in the caller's household",
)
def list_recipes(
    user: CurrentUser = Depends(current_user),
    tag: Optional[str] = Query(default=None, description="Filter by a tag in the recipe's tag list."),
    search: Optional[str] = Query(default=None, description="Case-insensitive substring match on recipe name."),
    source: Optional[RecipeSource] = Query(default=None, description="Filter by source."),
    status_filter: Optional[RecipeStatus] = Query(
        default=None,
        alias="status",
        description="Filter by status. Admin can pass 'pending' to see the household review queue.",
    ),
):
    """Default scope: every approved recipe in the caller's household, plus the
    caller's own pending recipes. Admin can pass `?status=pending` to see the
    full household review queue.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, user.id)

    q = sb.table("recipes").select("*").eq("household_id", household_id)

    if status_filter is not None:
        if status_filter == "pending" and role != "admin":
            # Non-admin asking for pending: scope to their own pending.
            q = q.eq("status", "pending").eq("submitted_by", user.id)
        else:
            q = q.eq("status", status_filter)
    else:
        # Default: approved OR own-pending.
        q = q.or_(f"status.eq.approved,submitted_by.eq.{user.id}")

    if tag is not None:
        q = q.contains("tags", [tag])
    if search is not None:
        q = q.ilike("name", f"%{search}%")
    if source is not None:
        q = q.eq("source", source)

    res = q.order("created_at", desc=True).execute()
    return {"recipes": res.data or []}


@router.post(
    "/recipes",
    response_model=RecipeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a recipe manually",
)
def create_recipe(body: RecipeCreate, user: CurrentUser = Depends(current_user)):
    """Persist a recipe. The FE uses this for all three paths:

    - Manual entry: body.source defaults to `'manual'`.
    - AI generate preview save: FE sets `source='ai_generated'` after the user
      confirms a `/recipes/generate` preview.
    - Photo extract preview save: FE sets `source='photo'` after a
      `/recipes/extract-photo` preview.

    Status depends on caller role, not on source: admin → `'approved'` (the
    human reviewed before clicking save); family → `'pending'` (admin still
    gates family contributions regardless of path).

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body (empty name, bad ingredient category, bad source enum).
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, user.id)

    payload = {
        "household_id": household_id,
        "name": body.name,
        "description": body.description,
        "ingredients": [ing.model_dump() for ing in body.ingredients],
        "instructions": body.instructions,
        "tags": body.tags,
        "prep_minutes": body.prep_minutes,
        "servings": body.servings,
        "source": body.source,
        "status": "approved" if role == "admin" else "pending",
        "submitted_by": user.id,
    }
    return _insert_recipe(sb, payload)


@router.get(
    "/recipes/{recipe_id}",
    response_model=RecipeOut,
    summary="Fetch a single recipe",
)
def get_recipe(recipe_id: UUID, user: CurrentUser = Depends(current_user)):
    """Fetch one recipe. Pending recipes are only visible to their submitter
    and admins; other family members get 404 (existence not leaked).

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 recipe not in caller's household, or pending and not own/admin.
    422 `recipe_id` is not a UUID.
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, user.id)
    return _fetch_recipe_for_caller(sb, str(recipe_id), household_id, user.id, role)


@router.patch(
    "/recipes/{recipe_id}",
    response_model=RecipeOut,
    summary="Admin edits a recipe",
)
def update_recipe(
    recipe_id: UUID,
    body: RecipeUpdate,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Admin patches any non-id field, including `status` if needed.

    Errors: 401 missing/invalid bearer. 403 caller is not admin / not in a
    household. 404 recipe not in caller's household. 422 empty body, bad
    enum, or `recipe_id` is not a UUID.
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, admin.id)
    recipe_id_str = str(recipe_id)
    _fetch_recipe_for_caller(sb, recipe_id_str, household_id, admin.id, role)

    patch: dict = body.model_dump(exclude_unset=True)
    if "ingredients" in patch and patch["ingredients"] is not None:
        patch["ingredients"] = [
            (ing if isinstance(ing, dict) else ing.model_dump())
            for ing in patch["ingredients"]
        ]

    sb.table("recipes").update(patch).eq("id", recipe_id_str).execute()
    return _fetch_recipe_for_caller(sb, recipe_id_str, household_id, admin.id, role)


@router.delete(
    "/recipes/{recipe_id}",
    response_model=OkResponse,
    summary="Admin deletes a recipe",
)
def delete_recipe(
    recipe_id: UUID,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Permanently delete a recipe. Admin only.

    Errors: 401 missing/invalid bearer. 403 caller is not admin / not in a
    household. 404 recipe not in caller's household. 422 `recipe_id` is
    not a UUID.
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, admin.id)
    recipe_id_str = str(recipe_id)
    _fetch_recipe_for_caller(sb, recipe_id_str, household_id, admin.id, role)

    sb.table("recipes").delete().eq("id", recipe_id_str).execute()
    return OkResponse()


@router.post(
    "/recipes/{recipe_id}/approve",
    response_model=RecipeOut,
    summary="Admin approves a pending recipe",
)
def approve_recipe(
    recipe_id: UUID,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Flip a recipe to `status='approved'` so the whole household sees it.

    Idempotent: calling on an already-approved recipe returns 200 with the
    row, not 409. Cross-household calls return 404.

    Errors: 401 missing/invalid bearer. 403 caller is not admin / not in a
    household. 404 recipe not in caller's household. 422 `recipe_id` is
    not a UUID.
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, admin.id)
    recipe_id_str = str(recipe_id)
    row = _fetch_recipe_for_caller(sb, recipe_id_str, household_id, admin.id, role)

    if row["status"] != "approved":
        sb.table("recipes").update({"status": "approved"}).eq("id", recipe_id_str).execute()
        row = _fetch_recipe_for_caller(sb, recipe_id_str, household_id, admin.id, role)
    return row


@router.post(
    "/recipes/generate",
    response_model=RecipePreview,
    summary="Generate a recipe preview via AI (pass-through, no DB write)",
)
async def generate(body: GenerateRecipeRequest, user: CurrentUser = Depends(current_user)):
    """Call the cookbook agent and return the result for the FE to render on
    a review screen. **Nothing is persisted.** The user edits / accepts on
    the screen, then the FE calls `POST /cookbook/recipes` with
    `source='ai_generated'` to save a single row. If the user cancels, no
    row is ever written.

    Open to any authenticated household member.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body. 502 the agent returned no usable recipe (`reason` set,
    `name` absent).
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)

    household_context = {
        "tag_hints": body.tag_hints,
        "household_members": _household_members_for_agent(sb, household_id),
    }
    result = await run_in_threadpool(generate_recipe, body.prompt, household_context)

    if not result.get("name"):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            result.get("reason") or "Recipe generation failed",
        )

    return RecipePreview(
        name=result["name"],
        description=result.get("description"),
        ingredients=result.get("ingredients") or [],
        instructions=result.get("instructions"),
        tags=result.get("tags") or [],
        prep_minutes=result.get("prep_minutes"),
        servings=result.get("servings"),
        source="ai_generated",
        reason=result.get("reason"),
    )


@router.post(
    "/recipes/extract-photo",
    response_model=RecipePreview,
    summary="Extract a recipe preview from a photo (pass-through, no DB write)",
)
async def extract_photo(body: ExtractPhotoRequest, user: CurrentUser = Depends(current_user)):
    """Call the recipe-photo agent and return the extracted data for the FE
    to render on a review screen. **Nothing is persisted.** The user edits /
    accepts, then the FE calls `POST /cookbook/recipes` with `source='photo'`
    to save a single row.

    Partial extractions return 200 with `reason` set so the FE can render a
    warning above the editable preview ("we couldn't read the cook time").
    Total failures (no usable name) return 502.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body / oversized image. 502 total agent failure.
    """
    sb = get_supabase()
    _caller_household(sb, user.id)

    result = await run_in_threadpool(
        extract_recipe_from_image, body.image_base64, body.media_type,
    )

    if not result.get("name"):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            result.get("reason") or "Image extraction failed",
        )

    return RecipePreview(
        name=result["name"],
        description=result.get("description"),
        ingredients=result.get("ingredients") or [],
        instructions=result.get("instructions"),
        tags=result.get("tags") or [],
        prep_minutes=result.get("prep_minutes"),
        servings=result.get("servings"),
        source="photo",
        reason=result.get("reason"),
    )


# ---------- Personalized description (per-user cache) ----------


def _recent_history_for_user(sb, user_id: str) -> list[dict[str, Any]]:
    """Last N reactions by this user, shaped for `personalize_recipe_description`.

    Returns `[{recipe_name, eaten_on, reaction}, ...]`. `recipe_name` is the
    `meal_plan_days.meal_name` (works for both cookbook recipes and agent-
    invented meals). `eaten_on` is the plan's `week_start` ISO date — the
    agent doesn't need day-precision for this signal.
    """
    recent = (
        sb.table("meal_plan_day_reactions")
        .select("day_id, reaction")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(_DESCRIPTION_HISTORY_LIMIT)
        .execute()
        .data
    ) or []
    if not recent:
        return []

    day_ids = [r["day_id"] for r in recent]
    days = (
        sb.table("meal_plan_days")
        .select("id, plan_id, meal_name")
        .in_("id", day_ids)
        .execute()
        .data
    ) or []
    day_by_id = {d["id"]: d for d in days}

    plan_ids = list({d["plan_id"] for d in days})
    plans = (
        sb.table("meal_plans")
        .select("id, week_start")
        .in_("id", plan_ids)
        .execute()
        .data
    ) or []
    week_by_plan = {p["id"]: p["week_start"] for p in plans}

    out: list[dict[str, Any]] = []
    for r in recent:
        d = day_by_id.get(r["day_id"])
        if not d:
            continue
        out.append({
            "recipe_name": d["meal_name"],
            "eaten_on": week_by_plan.get(d["plan_id"]),
            "reaction": r["reaction"],
        })
    return out


def _parse_ts(ts: Any) -> datetime:
    """Parse a Postgres timestamptz string into a timezone-aware datetime."""
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    s = str(ts).replace("Z", "+00:00")
    return datetime.fromisoformat(s)


@router.get(
    "/recipes/{recipe_id}/description",
    response_model=PersonalizedDescription,
    summary="Per-user, AI-generated personalized recipe description (cached)",
)
async def get_personalized_description(
    recipe_id: UUID, user: CurrentUser = Depends(current_user),
):
    """Return a personalized blurb for this recipe, tailored to the caller's
    profile and recent eating history.

    Cached per `(recipe_id, user_id)` in
    `public.recipe_personalized_descriptions`. Cache is invalidated automatically
    when the recipe's `updated_at` advances past the cached row's `generated_at`
    — admin editing a recipe forces every household member's next read to
    regenerate.

    The agent can return an empty string (its documented failure shape); we
    still cache that so a busted recipe doesn't hammer Claude on every read.
    FE should render the recipe without the blurb when `description == ""`.

    Errors: 401 missing/invalid bearer. 403 caller not in a household.
    404 recipe not in caller's household, or pending and not own/admin.
    422 `recipe_id` not a UUID.
    """
    sb = get_supabase()
    household_id, role = _caller_household(sb, user.id)
    recipe_id_s = str(recipe_id)
    recipe = _fetch_recipe_for_caller(sb, recipe_id_s, household_id, user.id, role)

    cached = (
        sb.table("recipe_personalized_descriptions")
        .select("description, generated_at")
        .eq("recipe_id", recipe_id_s)
        .eq("user_id", user.id)
        .execute()
        .data
    ) or []
    if cached:
        if _parse_ts(cached[0]["generated_at"]) >= _parse_ts(recipe["updated_at"]):
            return PersonalizedDescription(
                description=cached[0]["description"],
                generated_at=_parse_ts(cached[0]["generated_at"]),
            )

    user_row = (
        sb.table("users")
        .select("display_name, health_preferences, dietary_preferences")
        .eq("id", user.id)
        .single()
        .execute()
        .data
    ) or {}
    member_profile = {
        "display_name": user_row.get("display_name"),
        "age_group": None,
        "taste_preferences": None,
        "health_preferences": user_row.get("health_preferences") or {},
        "dietary_preferences": user_row.get("dietary_preferences") or {
            "dietary_types": [], "allergies": [], "dislikes": [],
        },
    }
    recent_history = _recent_history_for_user(sb, user.id)

    description = await run_in_threadpool(
        personalize_recipe_description, recipe, member_profile, recent_history,
    )
    if not isinstance(description, str):
        description = ""

    generated_at = datetime.now(tz=timezone.utc)
    sb.table("recipe_personalized_descriptions").upsert(
        {
            "recipe_id": recipe_id_s,
            "user_id": user.id,
            "description": description,
            "generated_at": generated_at.isoformat(),
        },
        on_conflict="recipe_id,user_id",
    ).execute()

    return PersonalizedDescription(description=description, generated_at=generated_at)

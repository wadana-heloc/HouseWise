from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

# These imports resolve via the sys.path shim in backend/app/main.py.
# They are imported at module load so the server fails fast if the AI
# team breaks any of these function signatures.
from cookbook_agent import generate_recipe, personalize_recipe_description  # noqa: F401
from recipe_photo_agent import extract_recipe_from_image

from ..auth.deps import CurrentUser, current_user, require_role
from ..auth.schemas import OkResponse
from ..supabase_client import get_supabase
from .schemas import (
    ExtractPhotoRequest,
    GenerateRecipeRequest,
    RecipeCreate,
    RecipeList,
    RecipeOut,
    RecipeSource,
    RecipeStatus,
    RecipeUpdate,
)

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
    """Manual recipe entry. Server forces `source='manual'` and
    `submitted_by=caller.id`. Status depends on role: admin manual entries
    auto-approve (visible household-wide immediately); family manual entries
    enter as `'pending'` and need an admin approve, same as AI/photo.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body (empty name, bad ingredient category, etc.).
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
        "source": "manual",
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
    response_model=RecipeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a recipe via AI (any household member)",
)
async def generate(body: GenerateRecipeRequest, user: CurrentUser = Depends(current_user)):
    """Call the cookbook agent to generate a recipe from a prompt + tag hints.

    Open to any authenticated household member. The generated recipe is
    saved as `source='ai_generated'`, `status='pending'` — visible only to
    the submitter and admin until an admin approves it.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body. 502 the agent returned an error with no usable recipe;
    no row is inserted.
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)

    household_context = {
        "tag_hints": body.tag_hints,
        "household_members": _household_members_for_agent(sb, household_id),
    }
    result = await run_in_threadpool(generate_recipe, body.prompt, household_context)

    if result.get("reason") and not result.get("name"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, result["reason"])

    payload = {
        "household_id": household_id,
        "name": result.get("name") or "Untitled recipe",
        "description": result.get("description"),
        "ingredients": result.get("ingredients") or [],
        "instructions": result.get("instructions"),
        "tags": result.get("tags") or [],
        "prep_minutes": result.get("prep_minutes"),
        "servings": result.get("servings"),
        "source": "ai_generated",
        "status": "pending",
        "submitted_by": user.id,
    }
    return _insert_recipe(sb, payload)


@router.post(
    "/recipes/extract-photo",
    response_model=RecipeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Extract a recipe from a photo via AI",
)
async def extract_photo(body: ExtractPhotoRequest, user: CurrentUser = Depends(current_user)):
    """Call the recipe-photo agent to extract a recipe from a product /
    cookbook page image. Open to any authenticated household member.

    Partial extractions are saved with the agent's `reason` appended to the
    description as an "Extraction note:". Total failures (no usable name)
    return 502 without inserting a row.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body / oversized image. 502 total agent failure (no row).
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)

    result = await run_in_threadpool(
        extract_recipe_from_image, body.image_base64, body.media_type,
    )

    if not result.get("name"):
        # Total failure shape per the contract: no name, only reason.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            result.get("reason") or "Image extraction failed",
        )

    description = result.get("description") or ""
    if result.get("reason"):
        suffix = f"\n\nExtraction note: {result['reason']}"
        description = (description + suffix).strip()

    payload = {
        "household_id": household_id,
        "name": result["name"],
        "description": description or None,
        "ingredients": result.get("ingredients") or [],
        "instructions": result.get("instructions"),
        "tags": result.get("tags") or [],
        "prep_minutes": result.get("prep_minutes"),
        "servings": result.get("servings"),
        "source": "photo",
        "status": "pending",
        "submitted_by": user.id,
    }
    return _insert_recipe(sb, payload)

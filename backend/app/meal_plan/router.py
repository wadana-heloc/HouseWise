from datetime import date, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

# Resolves via the sys.path shim in backend/app/main.py. Module-level so the
# server fails fast if the AI team breaks the function signature.
from meal_plan_agent import generate_weekly_plan

from ..auth.deps import CurrentUser, current_user, require_role
from ..supabase_client import get_supabase
from .schemas import (
    DayUpdate,
    GenerateMealPlanRequest,
    MealPlanOut,
    MemberSubmissionStatus,
    SubmissionOut,
    SubmissionStatusList,
    SubmissionUpsert,
)

router = APIRouter(prefix="/meal-plan", tags=["meal_plan"])


def _caller_household(sb, user_id: str) -> tuple[str, str]:
    """Return (household_id, role) for the caller. 403 if not in a household."""
    row = sb.table("users").select("household_id, role").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"], row.data.get("role") or ""


def _fetch_plan_with_days(sb, household_id: str, week_start: date) -> dict | None:
    plan_res = (
        sb.table("meal_plans")
        .select("*")
        .eq("household_id", household_id)
        .eq("week_start", week_start.isoformat())
        .execute()
    )
    if not plan_res.data:
        return None
    plan = plan_res.data[0]
    days_res = (
        sb.table("meal_plan_days")
        .select("*")
        .eq("plan_id", plan["id"])
        .order("day_of_week")
        .execute()
    )
    plan["days"] = days_res.data or []
    return plan


def _build_agent_context(sb, household_id: str, week_start: date) -> dict[str, Any]:
    """Assemble the dict passed to `generate_weekly_plan`.

    Shapes match the AI agent's contract — NOT the AI engineer's "backend plan",
    which references columns and table values that don't exist in our schema.
    """
    week_iso = week_start.isoformat()

    members = (
        sb.table("users")
        .select("id, display_name, health_preferences")
        .eq("household_id", household_id)
        .execute()
        .data
    ) or []

    submissions = (
        sb.table("meal_plan_submissions")
        .select("user_id, busy_days, meal_requests")
        .eq("household_id", household_id)
        .eq("week_start", week_iso)
        .execute()
        .data
    ) or []
    subs_by_user = {s["user_id"]: s for s in submissions}

    household_members = [
        {
            "display_name": m["display_name"],
            # age_group / taste_preferences columns don't exist in our schema.
            # The agent must tolerate None — fake defaults like "adult" would
            # mislead the LLM.
            "age_group": None,
            "taste_preferences": None,
            "health_preferences": m.get("health_preferences") or {},
            "busy_days": subs_by_user.get(m["id"], {}).get("busy_days", []),
            "meal_requests": subs_by_user.get(m["id"], {}).get("meal_requests", []),
        }
        for m in members
    ]

    recipes = (
        sb.table("recipes")
        .select("id, name, tags, prep_minutes, ingredients")
        .eq("household_id", household_id)
        .eq("status", "approved")
        .execute()
        .data
    ) or []
    available_recipes = [
        {
            "id": r["id"],
            "name": r["name"],
            "tags": r.get("tags") or [],
            "prep_minutes": r.get("prep_minutes"),
            "ingredient_categories": sorted(
                {ing["category"] for ing in (r.get("ingredients") or []) if "category" in ing}
            ),
        }
        for r in recipes
    ]

    prev_iso = (week_start - timedelta(days=7)).isoformat()
    prev_plan = (
        sb.table("meal_plans")
        .select("id")
        .eq("household_id", household_id)
        .eq("week_start", prev_iso)
        .execute()
        .data
    ) or []
    last_week_meals: list[str] = []
    if prev_plan:
        prev_days = (
            sb.table("meal_plan_days")
            .select("meal_name")
            .eq("plan_id", prev_plan[0]["id"])
            .execute()
            .data
        ) or []
        last_week_meals = [d["meal_name"] for d in prev_days]

    # Low-stock lives in its own table — `items.status='low_stock'` is not a
    # valid enum value in our schema (it's pending/in_review/approved/rejected/done).
    lows = (
        sb.table("low_stock_flags")
        .select("name")
        .eq("household_id", household_id)
        .execute()
        .data
    ) or []
    low_stock_items = [row["name"] for row in lows]

    return {
        "week_start": week_iso,
        "household_members": household_members,
        "available_recipes": available_recipes,
        "low_stock_items": low_stock_items,
        "last_week_meals": last_week_meals,
    }


# ---------- Submissions ----------


@router.post(
    "/submissions",
    response_model=SubmissionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit (or replace) the caller's week preferences",
)
def upsert_submission(body: SubmissionUpsert, user: CurrentUser = Depends(current_user)):
    """Family member submits their busy days and meal requests for the given
    week. Re-submitting the same week replaces the previous submission.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 invalid body (out-of-range busy_days, duplicate days, oversized
    meal_requests).
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)

    payload = {
        "household_id": household_id,
        "user_id": user.id,
        "week_start": body.week_start.isoformat(),
        "busy_days": body.busy_days,
        "meal_requests": [m.model_dump() for m in body.meal_requests],
    }
    sb.table("meal_plan_submissions").upsert(
        payload, on_conflict="household_id,user_id,week_start"
    ).execute()

    res = (
        sb.table("meal_plan_submissions")
        .select("*")
        .eq("household_id", household_id)
        .eq("user_id", user.id)
        .eq("week_start", body.week_start.isoformat())
        .single()
        .execute()
    )
    return res.data


@router.get(
    "/submissions/me",
    response_model=SubmissionOut,
    summary="Fetch the caller's own submission for a given week",
)
def get_own_submission(
    week_start: date = Query(...),
    user: CurrentUser = Depends(current_user),
):
    """Returns 404 if the caller has not yet submitted for that week.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 caller has not submitted for that week.
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)
    res = (
        sb.table("meal_plan_submissions")
        .select("*")
        .eq("household_id", household_id)
        .eq("user_id", user.id)
        .eq("week_start", week_start.isoformat())
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No submission for that week")
    return res.data[0]


@router.get(
    "/submissions/status",
    response_model=SubmissionStatusList,
    summary="Per-member submission status for the household",
)
def submissions_status(
    week_start: date = Query(...),
    user: CurrentUser = Depends(current_user),
):
    """Returns one row per member of the caller's household with a boolean
    `submitted` flag. Drives the admin "Member submissions N of M" card with
    names + check circles. Only booleans are leaked — never the meal_requests
    content of another member.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)

    members = (
        sb.table("users")
        .select("id, display_name")
        .eq("household_id", household_id)
        .execute()
        .data
    ) or []
    subs = (
        sb.table("meal_plan_submissions")
        .select("user_id")
        .eq("household_id", household_id)
        .eq("week_start", week_start.isoformat())
        .execute()
        .data
    ) or []
    submitted_ids = {s["user_id"] for s in subs}

    rows = [
        MemberSubmissionStatus(
            user_id=m["id"],
            display_name=m["display_name"],
            submitted=m["id"] in submitted_ids,
        )
        for m in members
    ]
    return SubmissionStatusList(
        week_start=week_start,
        submitted=sum(1 for r in rows if r.submitted),
        total=len(rows),
        members=rows,
    )


# ---------- Plan read ----------


@router.get(
    "/{week_start}",
    response_model=MealPlanOut,
    summary="Fetch the household's meal plan for a week",
)
def get_plan(week_start: date, user: CurrentUser = Depends(current_user)):
    """Returns the plan plus its 7 days sorted by `day_of_week`.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 no plan exists yet for that week (frontend shows "No plan generated
    yet"). 422 `week_start` is not a valid ISO date.
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, user.id)
    plan = _fetch_plan_with_days(sb, household_id, week_start)
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No plan for that week")
    return plan


# ---------- AI generate (admin) ----------


@router.post(
    "/generate",
    response_model=MealPlanOut,
    summary="Generate (or re-generate) a weekly plan via AI (admin only)",
)
async def generate(
    body: GenerateMealPlanRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Build the household context, call the meal-plan agent, and upsert one
    `meal_plans` row + replace the 7 `meal_plan_days` rows for that plan.

    Re-running for the same week replaces the existing draft. A total agent
    failure (`reason` set with an empty `days` array) returns 502 and no row
    is written.

    Errors: 401 missing/invalid bearer. 403 caller is not admin / not in a
    household. 422 invalid body. 502 agent total failure (no row).
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, admin.id)
    week_iso = body.week_start.isoformat()

    context = _build_agent_context(sb, household_id, body.week_start)
    result = await run_in_threadpool(generate_weekly_plan, context)

    days = result.get("days") or []
    if result.get("reason") and not days:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            result.get("reason") or "Meal plan generation failed",
        )
    if len(days) != 7:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Agent returned {len(days)} days, expected 7",
        )

    sb.table("meal_plans").upsert(
        {
            "household_id": household_id,
            "week_start": week_iso,
            "status": "draft",
            "ai_summary": result.get("ai_summary"),
            "created_by": admin.id,
        },
        on_conflict="household_id,week_start",
    ).execute()

    plan_row = (
        sb.table("meal_plans")
        .select("id")
        .eq("household_id", household_id)
        .eq("week_start", week_iso)
        .single()
        .execute()
    ).data
    plan_id = plan_row["id"]

    sb.table("meal_plan_days").delete().eq("plan_id", plan_id).execute()

    days_payload = [
        {
            "plan_id": plan_id,
            "day_of_week": d["day_of_week"],
            "recipe_id": d.get("recipe_id"),
            "meal_name": d["meal_name"],
            "prep_label": d.get("prep_label") or "fresh",
            "notes": d.get("notes"),
            "suggested_ingredients": d.get("suggested_ingredients") or [],
        }
        for d in days
    ]
    sb.table("meal_plan_days").insert(days_payload).execute()

    plan = _fetch_plan_with_days(sb, household_id, body.week_start)
    if plan is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Plan vanished after insert"
        )
    return plan


# ---------- Day-edit (admin) ----------


@router.patch(
    "/{plan_id}/days/{day_id}",
    response_model=MealPlanOut,
    summary="Admin edits a single day of a generated plan",
)
def update_day(
    plan_id: UUID,
    day_id: UUID,
    body: DayUpdate,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Patch one day's `meal_name`, `prep_label`, `notes`, or `recipe_id`.
    Returns the full updated plan so the caller doesn't need a follow-up GET.

    Errors: 401 missing/invalid bearer. 403 caller is not admin / not in a
    household. 404 day not found, plan_id mismatch, or cross-household.
    422 empty body, bad enum, or non-UUID path param.
    """
    sb = get_supabase()
    household_id, _ = _caller_household(sb, admin.id)
    plan_id_s, day_id_s = str(plan_id), str(day_id)

    plan_res = (
        sb.table("meal_plans")
        .select("id, household_id, week_start")
        .eq("id", plan_id_s)
        .execute()
    )
    if not plan_res.data or plan_res.data[0]["household_id"] != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Day not found")
    plan = plan_res.data[0]

    day_res = (
        sb.table("meal_plan_days")
        .select("id")
        .eq("id", day_id_s)
        .eq("plan_id", plan_id_s)
        .execute()
    )
    if not day_res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Day not found")

    patch: dict = body.model_dump(exclude_unset=True)
    if patch:
        sb.table("meal_plan_days").update(patch).eq("id", day_id_s).execute()

    week_start = date.fromisoformat(plan["week_start"])
    return _fetch_plan_with_days(sb, household_id, week_start)

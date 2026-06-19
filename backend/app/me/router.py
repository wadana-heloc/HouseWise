from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.deps import CurrentUser, current_user
from ..supabase_client import get_supabase
from .schemas import (
    DietaryPreferences,
    DietaryPreferencesUpdate,
    HealthPreferences,
    HealthPreferencesUpdate,
    MeHousehold,
    MeResponse,
    MeUser,
    ProfileUpdate,
)

router = APIRouter(tags=["me"])


def _merge_prefs(stored: dict | None) -> HealthPreferences:
    """Fill missing keys with defaults so the response is always the full shape."""
    return HealthPreferences(**(stored or {}))


def _merge_dietary(stored: dict | None) -> DietaryPreferences:
    """Fill missing keys with empty lists so the response is always the full shape."""
    return DietaryPreferences(**(stored or {}))


def _fetch_me(sb, user_id: str) -> MeUser:
    row = (
        sb.table("users")
        .select(
            "id, email, display_name, role, household_id, "
            "health_preferences, dietary_preferences"
        )
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User profile not found")
    data = row.data
    return MeUser(
        id=data["id"],
        email=data["email"],
        display_name=data["display_name"],
        role=data["role"],
        household_id=data.get("household_id"),
        health_preferences=_merge_prefs(data.get("health_preferences")),
        dietary_preferences=_merge_dietary(data.get("dietary_preferences")),
    )


@router.get(
    "/me",
    response_model=MeResponse,
    summary="Current user + household snapshot",
)
def me(u: CurrentUser = Depends(current_user)):
    """Return the bearer's profile, household, health preferences, and
    dietary preferences.

    Used right after login to populate the mobile app's local state. The
    `user.role` field tells the client whether to render admin-only UI.
    `user.health_preferences` always contains the full 5-key shape with
    defaults filled in (`false`) for any keys the user hasn't set.
    `user.dietary_preferences` always contains the full 3-key shape
    (`dietary_types`, `allergies`, `dislikes`) with empty lists for any
    keys the user hasn't set. `household` is null only during the brief
    window of a half-finished signup; in normal flows it's always present.

    Errors: 401 if the bearer is missing or invalid. 404 if the profile
    row is missing (data inconsistency — shouldn't happen in practice).
    """
    sb = get_supabase()
    user = _fetch_me(sb, u.id)

    household: MeHousehold | None = None
    if user.household_id:
        h = (
            sb.table("households")
            .select("id, name, admin_id")
            .eq("id", user.household_id)
            .single()
            .execute()
        )
        if h.data:
            household = MeHousehold(**h.data)

    return MeResponse(user=user, household=household)


@router.patch(
    "/me/profile",
    response_model=MeUser,
    summary="Update the caller's display name and/or email",
)
def patch_profile(body: ProfileUpdate, u: CurrentUser = Depends(current_user)):
    """Self-update `display_name` and/or `email` on the caller's profile.

    At least one field is required. Email changes are applied with
    `email_confirm=True`, so Supabase does **not** send a verification
    email — the new address is usable immediately (consistent with the v2
    auth design's "no email-link flows except admin password reset").

    Both `auth.users` and `public.users` are updated; mobile clients can
    log in with the new email straight away, while existing sessions stay
    valid until natural expiry.

    Errors: 401 missing/invalid bearer. 409 the new email is already
    registered. 422 empty body, malformed email, or `display_name` too long.
    """
    sb = get_supabase()
    patch: dict = {}

    if body.email is not None:
        try:
            sb.auth.admin.update_user_by_id(
                u.id,
                {"email": body.email, "email_confirm": True},
            )
        except Exception as e:
            msg = str(e).lower()
            if "already" in msg or "registered" in msg or "exists" in msg:
                raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Email update failed: {e}",
            )
        patch["email"] = body.email

    if body.display_name is not None:
        patch["display_name"] = body.display_name

    if patch:
        sb.table("users").update(patch).eq("id", u.id).execute()

    return _fetch_me(sb, u.id)


@router.patch(
    "/me/health-preferences",
    response_model=HealthPreferences,
    summary="Update the caller's health preferences",
)
def patch_health_preferences(
    body: HealthPreferencesUpdate,
    u: CurrentUser = Depends(current_user),
):
    """Partial update of the caller's health-preference toggles.

    Only fields present in the body are touched — unsent toggles keep
    whatever value they had before. Unknown keys are rejected with 422
    so typos in the mobile client surface loudly instead of silently
    persisting useless fields.

    The response is always the full 5-key shape with defaults filled in
    for keys the user has never set.

    Errors: 401 missing/invalid bearer. 422 empty body or unknown key.
    """
    sb = get_supabase()

    current = (
        sb.table("users")
        .select("health_preferences")
        .eq("id", u.id)
        .single()
        .execute()
    )
    if not current.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User profile not found")

    merged = dict(current.data.get("health_preferences") or {})
    merged.update(body.model_dump(exclude_unset=True))

    sb.table("users").update({"health_preferences": merged}).eq("id", u.id).execute()

    confirm = (
        sb.table("users")
        .select("health_preferences")
        .eq("id", u.id)
        .single()
        .execute()
    )
    return _merge_prefs(confirm.data.get("health_preferences"))


@router.patch(
    "/me/dietary-preferences",
    response_model=DietaryPreferences,
    summary="Update the caller's dietary preferences",
)
def patch_dietary_preferences(
    body: DietaryPreferencesUpdate,
    u: CurrentUser = Depends(current_user),
):
    """Partial update of the caller's dietary preferences.

    Three top-level keys — `dietary_types`, `allergies`, `dislikes` — each
    a list of strings. Only keys present in the body are touched; an
    unsent key keeps its current value. **Within a key, the FE sends the
    full replacement list** (no append semantics): PATCH `{allergies:
    ["peanuts"]}` replaces the entire allergies list.

    `dietary_types` is intentionally free-text — the FE owns the chip
    vocabulary (vegetarian / vegan / halal / keto / gluten-free /
    dairy-free / paleo / nut-free at time of writing).

    Errors: 401 missing/invalid bearer. 422 empty body.
    """
    sb = get_supabase()

    current = (
        sb.table("users")
        .select("dietary_preferences")
        .eq("id", u.id)
        .single()
        .execute()
    )
    if not current.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User profile not found")

    merged = dict(current.data.get("dietary_preferences") or {})
    merged.update(body.model_dump(exclude_unset=True))

    sb.table("users").update({"dietary_preferences": merged}).eq("id", u.id).execute()

    confirm = (
        sb.table("users")
        .select("dietary_preferences")
        .eq("id", u.id)
        .single()
        .execute()
    )
    return _merge_dietary(confirm.data.get("dietary_preferences"))

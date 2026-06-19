from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.deps import CurrentUser, current_user, require_role
from ..auth.schemas import OkResponse
from ..supabase_client import get_supabase
from .schemas import (
    AdminResetMemberPasswordRequest,
    CreateMemberRequest,
    CreateMemberResponse,
    MemberListResponse,
    MemberRow,
    ReportSettings,
    ReportSettingsUpdate,
    UpdateMemberRequest,
)

router = APIRouter(prefix="/household/members", tags=["household"])
report_router = APIRouter(prefix="/household/report-settings", tags=["household"])


def _admin_household_id(sb, admin_id: str) -> str:
    row = sb.table("users").select("household_id, role").eq("id", admin_id).single().execute()
    if not row.data or row.data.get("role") != "admin" or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not an admin of a household")
    return row.data["household_id"]


def _member_household_id(sb, user_id: str) -> str:
    row = sb.table("users").select("household_id").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"]


@router.get(
    "",
    response_model=MemberListResponse,
    summary="List all members in the caller's household",
)
def list_members(user: CurrentUser = Depends(current_user)):
    """Return every member of the caller's household (admin + family).

    Any authenticated household member may call this — admins to manage,
    family to render the roster (e.g. the home-screen member chips).
    Write endpoints in this module remain admin-only.

    Ordering is `role asc, created_at asc`: the admin appears first
    (`'admin' < 'family'` lexicographically), then family by join order.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    """
    sb = get_supabase()
    household_id = _member_household_id(sb, user.id)

    res = (
        sb.table("users")
        .select("id, email, display_name, role")
        .eq("household_id", household_id)
        .order("role")
        .order("created_at")
        .execute()
    )
    return MemberListResponse(members=res.data or [])


@router.get(
    "/{member_id}",
    response_model=MemberRow,
    summary="Fetch a single household member",
)
def get_member(member_id: UUID, user: CurrentUser = Depends(current_user)):
    """Fetch one member of the caller's household by id.

    Any authenticated household member may read any other member in the
    same household (including the admin, and including themselves — for
    self-reads `/me` is also available and returns more context).

    Cross-household reads return 404 so existence isn't leaked.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 member not found or not in caller's household. 422 `member_id` is
    not a UUID.
    """
    sb = get_supabase()
    household_id = _member_household_id(sb, user.id)

    res = (
        sb.table("users")
        .select("id, email, display_name, role")
        .eq("id", str(member_id))
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return res.data[0]


@router.post(
    "",
    response_model=CreateMemberResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Admin creates a family member (no invite email)",
)
def create_member(
    body: CreateMemberRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Create a family member directly under the admin's household.

    The member is created with `email_confirm=true` and `app_metadata.role='family'`,
    so they can log in immediately at `POST /auth/login` with the credentials
    in the request body. No invite email is sent — the admin shares the
    credentials with the member out of band.

    Requires an admin bearer token. The new member is placed in the same
    household as the calling admin.

    Errors: 403 if caller is not an admin. 409 if the email is already
    registered (in this household or globally). 422 on validation failure
    from Supabase.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    existing = (
        sb.table("users")
        .select("id")
        .eq("household_id", household_id)
        .eq("email", body.email)
        .execute()
    )
    if existing.data:
        raise HTTPException(status.HTTP_409_CONFLICT, "Member with that email already in household")

    try:
        created = sb.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            "email_confirm": True,
            "app_metadata": {"role": "family"},
            "user_metadata": {"display_name": body.display_name},
        })
    except Exception as e:
        msg = str(e).lower()
        if "already" in msg or "registered" in msg or "exists" in msg:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Member create failed: {e}")

    user_id = created.user.id

    sb.table("users").update({
        "household_id": household_id,
        "role": "family",
        "display_name": body.display_name,
        "email": body.email,
    }).eq("id", user_id).execute()

    confirm = sb.table("users").select("id, household_id, role").eq("id", user_id).single().execute()
    if (
        not confirm.data
        or confirm.data.get("household_id") != household_id
        or confirm.data.get("role") != "family"
    ):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Member profile write did not land")

    return CreateMemberResponse(user_id=user_id, email=body.email, display_name=body.display_name)


@router.post(
    "/{member_id}/password",
    response_model=OkResponse,
    summary="Admin resets a member's password (no email)",
)
def admin_reset_member_password(
    member_id: str,
    body: AdminResetMemberPasswordRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Set a new password for a family member directly. No email is sent.

    Used when a family member forgets their password — there is no
    member-facing email recovery flow, so the admin handles it. The admin
    must belong to the same household as the target member.

    **This does NOT invalidate the member's existing sessions.** Any
    outstanding access tokens stay valid until natural expiry (~1h) and
    refresh tokens remain usable. If you need to forcibly log the member
    out everywhere, delete and recreate the account.

    Admins changing their own password should use `POST /auth/password-update`,
    not this endpoint (400 if `member_id` equals the caller's id).

    Errors: 400 if caller targets themselves. 403 if caller is not an admin.
    404 if the member doesn't exist or is in a different household.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    if member_id == admin.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Admins use /auth/password-update for their own password",
        )

    member = sb.table("users").select("household_id").eq("id", member_id).execute()
    if not member.data or member.data[0].get("household_id") != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not in your household")

    # Note: this does NOT invalidate the member's existing access/refresh tokens.
    # Outstanding sessions remain usable until natural expiry.
    sb.auth.admin.update_user_by_id(member_id, {"password": body.new_password})
    return OkResponse()


@router.patch(
    "/{member_id}",
    response_model=MemberRow,
    summary="Admin updates a member's name or email",
)
def update_member(
    member_id: UUID,
    body: UpdateMemberRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Admin patches a family member's `display_name` and/or `email`.

    Email changes are applied with `email_confirm=True`, so Supabase does
    not send a verification email — the new address is usable immediately
    (consistent with v2 "no email-link flows except admin password reset").
    Both `auth.users` and `public.users` are updated.

    Admins changing their **own** name/email use
    `PATCH /me/profile`, not this endpoint (400 if `member_id` equals the
    caller's id). Health preferences are strictly self-managed; this
    endpoint cannot edit them.

    Errors: 400 caller targeted themselves. 403 caller is not an admin.
    404 member not found or not in caller's household. 409 the new email is
    already registered. 422 empty body, malformed email, or `member_id` is
    not a UUID.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)
    member_id_str = str(member_id)

    if member_id_str == admin.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Admins use /me/profile for their own profile",
        )

    member = (
        sb.table("users")
        .select("id, household_id")
        .eq("id", member_id_str)
        .eq("household_id", household_id)
        .execute()
    )
    if not member.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not in your household")

    patch: dict = {}
    if body.email is not None:
        try:
            sb.auth.admin.update_user_by_id(
                member_id_str,
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
        sb.table("users").update(patch).eq("id", member_id_str).execute()

    confirm = (
        sb.table("users")
        .select("id, email, display_name, role")
        .eq("id", member_id_str)
        .single()
        .execute()
    )
    return confirm.data


@router.delete(
    "/{member_id}",
    response_model=OkResponse,
    summary="Admin removes a family member",
)
def remove_member(member_id: str, admin: CurrentUser = Depends(require_role("admin"))):
    """Permanently delete a family member's account.

    Deletes from `auth.users`, which cascades to `public.users`, identities,
    sessions, and refresh tokens. After this call the member cannot log in,
    and any of their outstanding access tokens stop validating once they
    naturally expire (~1h).

    The admin must belong to the same household as the target member. Admins
    cannot remove themselves; use a separate flow for household ownership
    changes (not yet implemented).

    Errors: 400 if caller targets themselves or the target is also an admin.
    403 if caller is not an admin. 404 if the member doesn't exist or is in
    a different household.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    if member_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin cannot remove themselves")

    member = sb.table("users").select("household_id, role").eq("id", member_id).execute()
    if not member.data or member.data[0].get("household_id") != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not in your household")
    if member.data[0].get("role") == "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove the household admin")

    sb.auth.admin.delete_user(member_id)
    return OkResponse()


# ---------- Report settings (admin-only) ----------


def _fetch_report_settings(sb, household_id: str) -> ReportSettings:
    row = (
        sb.table("households")
        .select("report_day, report_time, report_timezone")
        .eq("id", household_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
    return ReportSettings(**row.data)


@report_router.get(
    "",
    response_model=ReportSettings,
    summary="Read the household's weekly report schedule",
)
def get_report_settings(admin: CurrentUser = Depends(require_role("admin"))):
    """Return the day, time, and timezone the weekly shopping report is
    scheduled for. Defaults are seeded at the DB level (`day=7 (Sunday)`,
    `time='09:00'`, `timezone='UTC'`), so the response is always fully
    populated even for a fresh household that's never PATCHed these
    settings.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin /
    not in a household.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)
    return _fetch_report_settings(sb, household_id)


@report_router.patch(
    "",
    response_model=ReportSettings,
    summary="Update the household's weekly report schedule",
)
def patch_report_settings(
    body: ReportSettingsUpdate,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Partial update of `report_day`, `report_time`, and/or
    `report_timezone`. Fields omitted from the body are left unchanged.
    Returns the full updated settings.

    `report_timezone` must be a valid IANA name (e.g. `Asia/Beirut`); the
    FE supplies it from `Intl.DateTimeFormat().resolvedOptions().timeZone`
    on first save.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin / not
    in a household. 422 empty body, `report_day` out of 1..7, malformed
    `report_time`, or unknown timezone.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    patch = body.model_dump(exclude_unset=True)
    if patch:
        sb.table("households").update(patch).eq("id", household_id).execute()

    return _fetch_report_settings(sb, household_id)

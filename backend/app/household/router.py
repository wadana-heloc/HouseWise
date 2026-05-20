from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.deps import CurrentUser, require_role
from ..auth.schemas import OkResponse
from ..supabase_client import get_supabase
from .schemas import (
    AdminResetMemberPasswordRequest,
    CreateMemberRequest,
    CreateMemberResponse,
)

router = APIRouter(prefix="/household/members", tags=["household"])


def _admin_household_id(sb, admin_id: str) -> str:
    row = sb.table("users").select("household_id, role").eq("id", admin_id).single().execute()
    if not row.data or row.data.get("role") != "admin" or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not an admin of a household")
    return row.data["household_id"]


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

    member = sb.table("users").select("household_id").eq("id", member_id).single().execute()
    if not member.data or member.data.get("household_id") != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not in your household")

    # Note: this does NOT invalidate the member's existing access/refresh tokens.
    # Outstanding sessions remain usable until natural expiry.
    sb.auth.admin.update_user_by_id(member_id, {"password": body.new_password})
    return OkResponse()


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

    member = sb.table("users").select("household_id, role").eq("id", member_id).single().execute()
    if not member.data or member.data.get("household_id") != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not in your household")
    if member.data.get("role") == "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove the household admin")

    sb.auth.admin.delete_user(member_id)
    return OkResponse()

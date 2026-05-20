from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.deps import CurrentUser, current_user
from ..supabase_client import get_supabase

router = APIRouter(tags=["me"])


class MeUser(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    household_id: str | None


class MeHousehold(BaseModel):
    id: str
    name: str
    admin_id: str


class MeResponse(BaseModel):
    user: MeUser
    household: MeHousehold | None


@router.get(
    "/me",
    response_model=MeResponse,
    summary="Current user + household snapshot",
)
def me(u: CurrentUser = Depends(current_user)):
    """Return the bearer's profile and the household they belong to.

    Used right after login to populate the mobile app's local state. The
    `user.role` field tells the client whether to render admin-only UI.
    `household` is null only during the brief window of a half-finished
    signup; in normal flows it's always present.

    Errors: 401 if the bearer is missing or invalid. 404 if the profile
    row is missing (data inconsistency — shouldn't happen in practice).
    """
    sb = get_supabase()
    row = (
        sb.table("users")
        .select("id, email, display_name, role, household_id")
        .eq("id", u.id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User profile not found")
    user = MeUser(**row.data)

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

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.deps import CurrentUser, current_user
from ..auth.schemas import OkResponse
from ..supabase_client import get_supabase
from .schemas import (
    LowStockFlagCreate,
    LowStockFlagList,
    LowStockFlagOut,
)

router = APIRouter(prefix="/low-stock", tags=["low-stock"])


def _caller_household_id(sb, user_id: str) -> str:
    row = sb.table("users").select("household_id").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"]


def _display_name_for(sb, user_id: str | None) -> str | None:
    if not user_id:
        return None
    row = sb.table("users").select("display_name").eq("id", user_id).single().execute()
    return row.data.get("display_name") if row.data else None


def _attach_display_names(sb, rows: list[dict]) -> list[dict]:
    ids = sorted({r["added_by"] for r in rows if r.get("added_by")})
    name_by_id: dict[str, str] = {}
    if ids:
        res = sb.table("users").select("id, display_name").in_("id", ids).execute()
        name_by_id = {u["id"]: u["display_name"] for u in (res.data or [])}
    for r in rows:
        r["added_by_display_name"] = name_by_id.get(r.get("added_by")) if r.get("added_by") else None
    return rows


@router.post(
    "",
    response_model=LowStockFlagOut,
    status_code=status.HTTP_201_CREATED,
    summary="Flag an item as running low",
)
def create_flag(body: LowStockFlagCreate, user: CurrentUser = Depends(current_user)):
    """Add a low-stock flag for the caller's household.

    Server sets `household_id` from the caller's profile and `added_by` to
    the caller. Any authenticated household member may call this.

    Uniqueness is **per-household, case-insensitive**: if "Dish soap" is
    already flagged in this household (by anyone — admin or another family
    member), this returns **409**. The flag must first be deleted before
    the same name can be flagged again.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    409 the name is already flagged in this household. 422 missing/empty
    name or name longer than 120 characters.
    """
    sb = get_supabase()
    household_id = _caller_household_id(sb, user.id)

    payload = {
        "household_id": household_id,
        "name": body.name,
        "added_by": user.id,
    }
    try:
        res = sb.table("low_stock_flags").insert(payload).execute()
    except Exception as e:
        msg = str(e).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This item is already flagged in your household",
            )
        raise

    if not res.data:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Flag insert returned no row")

    row = dict(res.data[0])
    row["added_by_display_name"] = _display_name_for(sb, row.get("added_by"))
    return row


@router.get(
    "",
    response_model=LowStockFlagList,
    summary="List low-stock flags in the caller's household",
)
def list_flags(user: CurrentUser = Depends(current_user)):
    """List every low-stock flag in the caller's household, newest first.

    Each row includes `added_by_display_name` so the mobile client can
    render "Flagged by Maha" without a second round-trip.

    Cross-household flags are never returned — every query is scoped to
    the caller's `household_id`.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    """
    sb = get_supabase()
    household_id = _caller_household_id(sb, user.id)

    res = (
        sb.table("low_stock_flags")
        .select("*")
        .eq("household_id", household_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = _attach_display_names(sb, list(res.data or []))
    return {"flags": rows}


@router.delete(
    "/{flag_id}",
    response_model=OkResponse,
    summary="Clear a low-stock flag",
)
def delete_flag(flag_id: UUID, user: CurrentUser = Depends(current_user)):
    """Permanently delete a low-stock flag.

    Open to any household member — by design, anyone who notices the item
    was bought can clear the flag. Cross-household deletes return 404 so
    existence isn't leaked.

    After deletion the name is free to be flagged again.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 flag not found or not in caller's household. 422 `flag_id` is not
    a UUID.
    """
    sb = get_supabase()
    household_id = _caller_household_id(sb, user.id)

    res = (
        sb.table("low_stock_flags")
        .select("id")
        .eq("id", str(flag_id))
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flag not found")

    sb.table("low_stock_flags").delete().eq("id", str(flag_id)).execute()
    return OkResponse()

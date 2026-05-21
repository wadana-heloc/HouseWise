from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth.deps import CurrentUser, current_user
from ..auth.schemas import OkResponse
from ..supabase_client import get_supabase
from .schemas import (
    ItemCategory,
    ItemCreate,
    ItemList,
    ItemOut,
    ItemStatus,
    ItemStatusUpdate,
    ItemUpdate,
)

router = APIRouter(prefix="/items", tags=["items"])


_ADMIN_ONLY_STATUSES: set[str] = {"in_review", "approved", "rejected"}


def _user_household(sb, user_id: str) -> tuple[str, str]:
    """Return (household_id, role) for the caller. 403 if not in a household."""
    row = sb.table("users").select("household_id, role").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"], row.data["role"]


def _fetch_item_in_household(sb, item_id: str, household_id: str) -> dict:
    res = (
        sb.table("items")
        .select("*")
        .eq("id", item_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return res.data[0]


def _check_transition(current: str, new: str, role: str) -> None:
    if current == new:
        return
    if new == "done":
        return
    if current == "done" and new == "pending":
        return
    admin_transitions = {
        ("pending", "in_review"),
        ("pending", "approved"),
        ("pending", "rejected"),
        ("in_review", "approved"),
        ("in_review", "rejected"),
        ("in_review", "pending"),
        ("rejected", "pending"),
    }
    if (current, new) in admin_transitions:
        if role != "admin":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Only admins can transition {current} -> {new}",
            )
        return
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        f"Invalid status transition {current} -> {new}",
    )


@router.post(
    "",
    response_model=ItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add an item to the household list",
)
def create_item(body: ItemCreate, user: CurrentUser = Depends(current_user)):
    """Create an item in the caller's household with `status='pending'` and
    `added_by=caller.id`. Any household member can call this.
    """
    sb = get_supabase()
    household_id, _ = _user_household(sb, user.id)

    payload = {
        "household_id": household_id,
        "name": body.name,
        "category": body.category,
        "quantity": str(body.quantity),
        "unit": body.unit,
        "urgent": body.urgent,
        "notes": body.notes,
        "added_by": user.id,
    }
    res = sb.table("items").insert(payload).execute()
    if not res.data:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Item insert returned no row")
    return res.data[0]


@router.get(
    "",
    response_model=ItemList,
    summary="List items in the caller's household",
)
def list_items(
    user: CurrentUser = Depends(current_user),
    status_filter: Optional[ItemStatus] = Query(default=None, alias="status"),
    urgent: Optional[bool] = None,
    category: Optional[ItemCategory] = None,
    added_by: Optional[str] = None,
):
    """List items in the caller's household, newest first. Urgent items float
    to the top. All filters are optional and AND-combined.
    """
    sb = get_supabase()
    household_id, _ = _user_household(sb, user.id)

    q = sb.table("items").select("*").eq("household_id", household_id)
    if status_filter is not None:
        q = q.eq("status", status_filter)
    if urgent is not None:
        q = q.eq("urgent", urgent)
    if category is not None:
        q = q.eq("category", category)
    if added_by is not None:
        q = q.eq("added_by", added_by)
    res = q.order("urgent", desc=True).order("created_at", desc=True).execute()
    return {"items": res.data or []}


@router.get(
    "/{item_id}",
    response_model=ItemOut,
    summary="Fetch a single item",
)
def get_item(item_id: UUID, user: CurrentUser = Depends(current_user)):
    sb = get_supabase()
    household_id, _ = _user_household(sb, user.id)
    return _fetch_item_in_household(sb, str(item_id), household_id)


@router.patch(
    "/{item_id}",
    response_model=ItemOut,
    summary="Update item fields (not status)",
)
def update_item(
    item_id: UUID,
    body: ItemUpdate,
    user: CurrentUser = Depends(current_user),
):
    """Update any non-status field. Any household member can call this. To
    change `status`, use `POST /items/{id}/status`.
    """
    sb = get_supabase()
    household_id, _ = _user_household(sb, user.id)
    item_id_str = str(item_id)
    _fetch_item_in_household(sb, item_id_str, household_id)

    patch: dict = body.model_dump(exclude_unset=True)
    if "quantity" in patch and patch["quantity"] is not None:
        patch["quantity"] = str(patch["quantity"])

    sb.table("items").update(patch).eq("id", item_id_str).execute()
    return _fetch_item_in_household(sb, item_id_str, household_id)


@router.post(
    "/{item_id}/status",
    response_model=ItemOut,
    summary="Transition an item's status",
)
def update_status(
    item_id: UUID,
    body: ItemStatusUpdate,
    user: CurrentUser = Depends(current_user),
):
    """Move an item to a new status. Anyone may set `done` or undo
    `done -> pending`. Only admins may set `in_review`, `approved`, `rejected`,
    or reopen a rejected item.
    """
    sb = get_supabase()
    household_id, role = _user_household(sb, user.id)
    item_id_str = str(item_id)
    item = _fetch_item_in_household(sb, item_id_str, household_id)

    _check_transition(item["status"], body.status, role)

    sb.table("items").update({"status": body.status}).eq("id", item_id_str).execute()
    return _fetch_item_in_household(sb, item_id_str, household_id)


@router.delete(
    "/{item_id}",
    response_model=OkResponse,
    summary="Delete an item",
)
def delete_item(item_id: UUID, user: CurrentUser = Depends(current_user)):
    """Permanently delete an item. Allowed for the original creator
    (`added_by == caller`) or any admin in the household.
    """
    sb = get_supabase()
    household_id, role = _user_household(sb, user.id)
    item_id_str = str(item_id)
    item = _fetch_item_in_household(sb, item_id_str, household_id)

    if role != "admin" and item.get("added_by") != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the creator or an admin can delete this item",
        )

    sb.table("items").delete().eq("id", item_id_str).execute()
    return OkResponse()

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

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
    ProductScanResponse,
    ScanImageRequest,
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
    """Add an item to the caller's household shopping list.

    The server sets `status='pending'`, `added_by=caller.id`, and
    `household_id` from the caller's profile — clients cannot override these.
    Any authenticated household member (admin or family) may call this.

    The new item enters the approval workflow at `pending`. Use
    `POST /items/{id}/status` to advance it (see that endpoint for the
    permission matrix).

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 on schema validation (bad enum, `quantity <= 0`, `name` too long, etc.).
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
    status_filter: Optional[ItemStatus] = Query(
        default=None,
        alias="status",
        description="Filter by status. One of: pending, in_review, approved, rejected, done.",
    ),
    urgent: Optional[bool] = Query(default=None, description="If true, return only urgent items."),
    category: Optional[ItemCategory] = Query(default=None, description="Filter by category."),
    added_by: Optional[str] = Query(default=None, description="Filter by creator user id."),
):
    """List items in the caller's household.

    Ordering: `urgent desc, created_at desc` — urgent items float to the top,
    then newest first within each group.

    All query filters are optional and AND-combined. Cross-household items are
    never returned (every query is scoped to the caller's `household_id`).

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 if a query parameter has an invalid enum value.
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
    """Fetch a single item by id.

    The item must belong to the caller's household. Cross-household reads
    return 404 (not 403) so existence isn't leaked.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 item not found or not in caller's household. 422 `item_id` is not a UUID.
    """
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
    """Patch any non-status field on an existing item.

    Editable fields: `name`, `category`, `quantity`, `unit`, `urgent`, `notes`.
    Only the fields you include in the body are touched. To change `status`,
    use `POST /items/{id}/status` — this endpoint will not.

    **Allowed callers** (FR-017): the original creator (`added_by == caller.id`)
    or any admin in the same household. Any other household member gets 403.

    **Allowed when** (FR-017): only while the item is in `status='pending'`.
    Editing an `in_review`, `approved`, `rejected`, or `done` item is blocked
    with **409** for everyone, admin included. To edit such an item, an admin
    must first move it back to `pending` via `POST /items/{id}/status`.

    Cross-household patches return 404 so existence isn't leaked.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household, or
    is a non-creator non-admin family member. 404 item not found or not in
    caller's household. 409 item is not in `pending`. 422 empty body, bad
    enum, `quantity <= 0`, or `item_id` is not a UUID.
    """
    sb = get_supabase()
    household_id, role = _user_household(sb, user.id)
    item_id_str = str(item_id)
    item = _fetch_item_in_household(sb, item_id_str, household_id)

    if role != "admin" and item.get("added_by") != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the item creator or an admin may edit",
        )

    if item["status"] != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot edit item — status is '{item['status']}'. "
            "Only pending items are editable.",
        )

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
    """Transition an item's `status` field.

    Allowed transitions:

    - **Any household member** may set `done` (from any state) or undo
      `done -> pending`.
    - **Admins only** may set `in_review`, `approved`, or `rejected` from
      `pending`; move between `in_review`, `approved`, `rejected`, and
      `pending`; or reopen `rejected -> pending`.
    - Setting the same status (no-op) is accepted and returns the row unchanged.

    Anything else is rejected with **400 Invalid status transition**. Full
    state machine: see [docs/items-flow.md](../docs/items-flow.md).

    Errors: 400 transition is not in the allowed set. 401 missing/invalid bearer.
    403 caller is not in a household, or is a non-admin attempting an admin-only
    transition. 404 item not found or not in caller's household. 422 unknown
    `status` value or `item_id` is not a UUID.
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
    """Permanently delete an item.

    **Allowed callers** (FR-018): the original creator (`added_by == caller.id`)
    or any admin in the same household. Any other household member gets 403.

    **Allowed when** (FR-018): only while the item is in `status='pending'`.
    Deleting an `in_review`, `approved`, `rejected`, or `done` item is blocked
    with **409** for everyone, admin included. Move the item back to `pending`
    via `POST /items/{id}/status` first if a delete is really needed.

    Cross-household deletes return 404.

    The delete is hard — there is no soft-delete column. If you need an
    audit trail of removed items, that's a future feature.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household, or
    is a non-creator, non-admin family member. 404 item not found or not in
    caller's household. 409 item is not in `pending`. 422 `item_id` is not a UUID.
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

    if item["status"] != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot delete item — status is '{item['status']}'. "
            "Only pending items are deletable.",
        )

    sb.table("items").delete().eq("id", item_id_str).execute()
    return OkResponse()


@router.post(
    "/scan-image",
    response_model=ProductScanResponse,
    summary="Extract name/brand/size from a product photo",
)
async def scan_image(
    body: ScanImageRequest,
    user: CurrentUser = Depends(current_user),
):
    """Run a product photo through the image-analysis agent.

    Pass-through: the backend forwards `image_base64` + `media_type` to the
    agent (EasyOCR + Claude under the hood) and returns the structured
    result. **Nothing is persisted** — the user reviews `name`/`brand`/`size`
    on the mobile confirmation form, then calls `POST /items` separately
    to save.

    `reason` is `null` when at least partial extraction succeeded. When the
    image is unreadable or the agent hit an error, `reason` is a short
    description string and `name`/`brand`/`size` are all `null`. The HTTP
    status is **always 200** in those cases — the failure shape lives in the
    response body, per the agent contract.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    422 `image_base64` empty or larger than `SCAN_IMAGE_MAX_BASE64`, or
    `media_type` is not one of `image/jpeg`/`png`/`webp`/`gif`. 503 the
    image agent is not available in this deployment.
    """
    sb = get_supabase()
    _user_household(sb, user.id)

    try:
        from image_agent import analyze_product_image
    except ImportError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Image-analysis agent is not available in this deployment",
        )

    result = await run_in_threadpool(
        analyze_product_image, body.image_base64, body.media_type,
    )
    return ProductScanResponse(
        name=result.name,
        brand=result.brand,
        size=result.size,
        reason=result.reason,
    )

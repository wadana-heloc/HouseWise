from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.deps import CurrentUser, current_user, require_role
from ..auth.schemas import OkResponse
from ..household.router import _admin_household_id
from ..items.router import _user_household
from ..supabase_client import get_supabase
from .schemas import ToBuyEntryOut, ToBuyListOut, ToBuyReplaceRequest

router = APIRouter(prefix="/to-buy", tags=["to-buy"])


_ELIGIBLE_PICK_STATUSES: set[str] = {"pending", "approved"}


def _entry_with_item(row: dict, item_row: dict) -> ToBuyEntryOut:
    """Project a DB row + its joined items row into ToBuyEntryOut."""
    return ToBuyEntryOut(
        id=row["id"],
        household_id=row["household_id"],
        item_id=row["item_id"],
        item_name=item_row["name"],
        quantity=Decimal(str(item_row["quantity"])),
        unit=item_row["unit"],
        chosen_store_url=row["chosen_store_url"],
        chosen_store_name=row["chosen_store_name"],
        chosen_price=Decimal(str(row["chosen_price"])),
        currency=row["currency"],
        snapshot_at=row["snapshot_at"],
        added_by=row.get("added_by"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _list_entries(sb, household_id: str) -> ToBuyListOut:
    """Read the household's current to-buy list and shape the response."""
    rows = (
        sb.table("to_buy_list")
        .select("*")
        .eq("household_id", household_id)
        .order("created_at", desc=False)
        .execute()
        .data
    ) or []

    if not rows:
        return ToBuyListOut(entries=[], item_count=0, estimated_total=Decimal("0"), currency="AED")

    item_ids = [row["item_id"] for row in rows]
    items = (
        sb.table("items")
        .select("id, name, quantity, unit")
        .in_("id", item_ids)
        .execute()
        .data
    ) or []
    items_by_id = {it["id"]: it for it in items}

    entries: list[ToBuyEntryOut] = []
    for row in rows:
        item_row = items_by_id.get(row["item_id"])
        if not item_row:
            # The items row was deleted via Supabase studio or cascade; skip
            # this orphan rather than 500 — admin will see N-1 entries.
            continue
        entries.append(_entry_with_item(row, item_row))

    total = sum((e.chosen_price for e in entries), start=Decimal("0"))
    currency = entries[0].currency if entries else "AED"
    return ToBuyListOut(
        entries=entries,
        item_count=len(entries),
        estimated_total=total,
        currency=currency,
    )


@router.post(
    "",
    response_model=ToBuyListOut,
    summary="Replace the household's to-buy list (admin only)",
)
def replace_to_buy(
    body: ToBuyReplaceRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Replace the household's to-buy list with `entries` (atomic-ish: delete
    then insert in a single handler). An empty `entries` list clears the
    list entirely.

    Every `item_id` must belong to the caller's household and have status in
    `pending` or `approved` (per the locked design — admin picks from those
    two statuses; never from in_review / rejected / done).

    Cross-household item_ids → 404. Item in disallowed status → 409 naming
    the offending item id + status.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin / not in
    a household. 404 any `item_id` is not in the caller's household. 409 any
    item is in a status other than pending/approved. 422 schema violations.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    # Validate every item_id belongs to this household and is in a pickable status.
    if body.entries:
        item_ids = [e.item_id for e in body.entries]
        rows = (
            sb.table("items")
            .select("id, status")
            .eq("household_id", household_id)
            .in_("id", item_ids)
            .execute()
            .data
        ) or []
        found = {r["id"]: r["status"] for r in rows}
        for item_id in item_ids:
            if item_id not in found:
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND,
                    f"Item {item_id} not in your household",
                )
            if found[item_id] not in _ELIGIBLE_PICK_STATUSES:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Item {item_id} has status '{found[item_id]}'. "
                    "Only pending or approved items can be added to the to-buy list.",
                )

    # Delete existing → insert new. No FK row points at to_buy_list rows, so
    # the delete is safe (no cascade to worry about). Brief window between
    # delete and insert is documented; admin-only endpoint so contention is
    # near-zero.
    sb.table("to_buy_list").delete().eq("household_id", household_id).execute()

    if body.entries:
        payload = [
            {
                "household_id": household_id,
                "item_id": e.item_id,
                "chosen_store_url": e.chosen_store_url,
                "chosen_store_name": e.chosen_store_name,
                "chosen_price": str(e.chosen_price),
                "currency": e.currency,
                "added_by": admin.id,
            }
            for e in body.entries
        ]
        sb.table("to_buy_list").insert(payload).execute()

    return _list_entries(sb, household_id)


@router.get(
    "",
    response_model=ToBuyListOut,
    summary="List the household's current to-buy entries",
)
def get_to_buy(user: CurrentUser = Depends(current_user)):
    """Return the caller's household to-buy list with item info joined
    (`item_name`, `quantity`, `unit`) and an aggregate `estimated_total`.

    Readable by any household member — family needs to see what's being
    bought so they don't buy duplicates while admin is shopping.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    """
    sb = get_supabase()
    household_id, _ = _user_household(sb, user.id)
    return _list_entries(sb, household_id)


@router.post(
    "/{entry_id}/done",
    response_model=OkResponse,
    summary="Mark a to-buy entry bought (any household member)",
)
def mark_done(entry_id: UUID, user: CurrentUser = Depends(current_user)):
    """Mark an entry bought. Two side effects, both required (FR sync invariant):

    1. **Flip the underlying `items.status` to `'done'`** — the act of marking
       it bought on the to-buy list is the same event as buying it.
    2. **Delete the to-buy entry** — the list represents what still needs buying.

    Any household member may call this (matches `POST /items/{id}/status`
    semantics for `done`). Cross-household / unknown entry → 404.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    404 entry not in caller's household or already gone. 422 entry_id not a UUID.
    """
    sb = get_supabase()
    household_id, _ = _user_household(sb, user.id)
    entry_id_s = str(entry_id)

    entry = (
        sb.table("to_buy_list")
        .select("id, item_id, household_id")
        .eq("id", entry_id_s)
        .eq("household_id", household_id)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To-buy entry not found")

    item_id = entry[0]["item_id"]

    # Order matters: flip items first; if that fails we don't lose the
    # to-buy row, so the sync invariant is observable and the admin can retry.
    sb.table("items").update({"status": "done"}).eq("id", item_id).execute()
    sb.table("to_buy_list").delete().eq("id", entry_id_s).execute()
    return OkResponse()


@router.delete(
    "/{entry_id}",
    response_model=OkResponse,
    summary="Remove a to-buy entry without marking the item bought (admin only)",
)
def remove_entry(
    entry_id: UUID,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Drop an entry from the to-buy list because admin changed their mind.
    Does **not** touch the underlying `items.status` (use `POST /to-buy/{id}/done`
    for that).

    Errors: 401 missing/invalid bearer. 403 caller is not admin / not in a
    household. 404 entry not in caller's household. 422 entry_id not a UUID.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)
    entry_id_s = str(entry_id)

    res = (
        sb.table("to_buy_list")
        .select("id")
        .eq("id", entry_id_s)
        .eq("household_id", household_id)
        .execute()
        .data
    )
    if not res:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To-buy entry not found")

    sb.table("to_buy_list").delete().eq("id", entry_id_s).execute()
    return OkResponse()

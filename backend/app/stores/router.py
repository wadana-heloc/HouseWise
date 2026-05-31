from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.deps import CurrentUser, current_user, require_role
from ..auth.schemas import OkResponse
from ..household.router import _admin_household_id
from ..supabase_client import get_supabase
from .schemas import (
    StoreCreate,
    StoreList,
    StoreOut,
    StoreUpdate,
)

router = APIRouter(prefix="/stores", tags=["stores"])


def _caller_household_id(sb, user_id: str) -> str:
    row = sb.table("users").select("household_id").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"]


def _is_unique_violation(e: Exception) -> bool:
    msg = str(e).lower()
    return "duplicate" in msg or "unique" in msg or "23505" in msg


def _fetch_store_in_household(sb, store_id: str, household_id: str) -> dict:
    res = (
        sb.table("stores")
        .select("*")
        .eq("id", store_id)
        .eq("household_id", household_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found")
    return res.data[0]


@router.post(
    "",
    response_model=StoreOut,
    status_code=status.HTTP_201_CREATED,
    summary="Admin adds a store to the household",
)
def create_store(
    body: StoreCreate,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Add a store to the caller's household. Admin only.

    The `url` is normalized before storage: bare hosts like `carrefour.ae`
    are accepted and saved as `https://carrefour.ae/`. Garbage input
    (`abc`, `javascript:`, single-label hosts) is rejected with 422.

    Names are case-insensitively unique per household — re-adding
    `"Carrefour"` (or `"CARREFOUR"`) in the same household returns **409**.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin.
    409 name already exists in this household. 422 empty/invalid name
    or invalid URL.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    payload = {
        "household_id": household_id,
        "name": body.name,
        "url": body.url,
        "added_by": admin.id,
    }
    try:
        res = sb.table("stores").insert(payload).execute()
    except Exception as e:
        if _is_unique_violation(e):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A store with that name already exists in your household",
            )
        raise

    if not res.data:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Store insert returned no row")
    return res.data[0]


@router.get(
    "",
    response_model=StoreList,
    summary="List stores in the caller's household",
)
def list_stores(user: CurrentUser = Depends(current_user)):
    """List every store in the caller's household, ordered alphabetically.

    Open to any authenticated household member — the AI report
    consumers (admin or family) need this list to know which shops to
    compare prices across.

    Cross-household stores are never returned.

    Errors: 401 missing/invalid bearer. 403 caller is not in a household.
    """
    sb = get_supabase()
    household_id = _caller_household_id(sb, user.id)

    res = (
        sb.table("stores")
        .select("*")
        .eq("household_id", household_id)
        .order("name")
        .execute()
    )
    return {"stores": res.data or []}


@router.patch(
    "/{store_id}",
    response_model=StoreOut,
    summary="Admin updates a store's name or url",
)
def update_store(
    store_id: UUID,
    body: StoreUpdate,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Patch a store's `name` and/or `url`. Admin only. Empty body → 422.

    URL is normalized before storage (same rules as create). Renaming to
    a name that already exists in the same household → 409.

    Cross-household patches return 404.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin.
    404 store not found or not in caller's household. 409 the new name
    already exists in this household. 422 empty body, invalid URL,
    name too long, or `store_id` is not a UUID.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)
    store_id_str = str(store_id)

    _fetch_store_in_household(sb, store_id_str, household_id)

    patch: dict = body.model_dump(exclude_unset=True)
    try:
        sb.table("stores").update(patch).eq("id", store_id_str).execute()
    except Exception as e:
        if _is_unique_violation(e):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A store with that name already exists in your household",
            )
        raise

    return _fetch_store_in_household(sb, store_id_str, household_id)


@router.delete(
    "/{store_id}",
    response_model=OkResponse,
    summary="Admin removes a store",
)
def delete_store(
    store_id: UUID,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Permanently delete a store. Admin only.

    Cross-household deletes return 404 so existence isn't leaked.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin.
    404 store not found or not in caller's household. 422 `store_id` is
    not a UUID.
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)
    store_id_str = str(store_id)

    _fetch_store_in_household(sb, store_id_str, household_id)
    sb.table("stores").delete().eq("id", store_id_str).execute()
    return OkResponse()

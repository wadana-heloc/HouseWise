import os

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from ..auth.deps import CurrentUser, require_role
from ..household.router import _admin_household_id
from ..supabase_client import get_supabase
from .schemas import (
    ItemPriceOut,
    PriceSearchRequest,
    PriceSearchResponse,
    StorePriceOut,
)

router = APIRouter(prefix="/prices", tags=["prices"])


def _is_total_failure(results: list[dict]) -> bool:
    """True only when every price in every result is null — complete agent failure."""
    for entry in results:
        for p in entry.get("prices", []):
            if p.get("price") is not None:
                return False
    return True


@router.post(
    "/search",
    response_model=PriceSearchResponse,
    summary="Search grocery prices across UAE stores (admin only)",
)
async def search_prices(
    body: PriceSearchRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Search grocery prices for `items` across the configured UAE stores via
    the price agent (Spinneys, Carrefour UAE, Union Coop, LuLu Hypermarket —
    hardcoded in `ai_agents/price-agent/price_config.py`).

    Provide `items` directly (e.g. `["milk 2L", "eggs 12pcs"]`), set
    `use_low_stock=true` to merge in the household's currently-flagged
    low-stock names, or both (lists are concatenated; duplicates dropped while
    preserving order).

    Per-store `price: null` is **normal** — the agent could not confirm a
    price at that store this run. A 502 is raised only when every price across
    every item and every store is null (total agent failure; safe to retry).

    Set `PRICE_AGENT_DUMMY=true` in the environment to use the cheap Haiku
    mock (no web search, fake prices) — useful while developing the FE.
    Unset or false uses the real Sonnet + web-search agent.

    Errors: 401 missing/invalid bearer. 403 caller is not an admin / not in
    a household. 422 schema violation (empty body, whitespace-only item).
    503 price agent module not available in this deployment. 502 total agent
    failure (all-null result).
    """
    sb = get_supabase()
    household_id = _admin_household_id(sb, admin.id)

    # Lazy import — keeps app boot resilient if the agent module isn't
    # packaged in this deployment (matches the image_agent pattern). The
    # dummy toggle reads the env var per request; FastAPI sees the toggle
    # on the next request after restart.
    try:
        if os.getenv("PRICE_AGENT_DUMMY", "").lower() in ("1", "true", "yes"):
            from price_agent_dummy import search_grocery_prices
        else:
            from price_agent import search_grocery_prices
        from price_config import STORE_URLS
    except ImportError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Price agent is not available in this deployment",
        )

    # Merge sources (explicit items first, then low-stock names that aren't
    # already in the list — case-sensitive dedup; admin can normalise FE-side).
    items: list[str] = list(body.items)

    if body.use_low_stock:
        flags = (
            sb.table("low_stock_flags")
            .select("name")
            .eq("household_id", household_id)
            .execute()
            .data
        ) or []
        for flag in flags:
            name = (flag.get("name") or "").strip()
            if name and name not in items:
                items.append(name)

    if not items:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No items to search — provide 'items' or flag items as low-stock first",
        )

    results = await run_in_threadpool(search_grocery_prices, items, STORE_URLS)

    if _is_total_failure(results):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Price agent returned no prices for any item or store",
        )

    return PriceSearchResponse(
        results=[
            ItemPriceOut(
                item=r["item"],
                prices=[StorePriceOut(**p) for p in r["prices"]],
                cheapest_store_url=r.get("cheapest_store_url"),
                cheapest_price=r.get("cheapest_price"),
                best_value_store_url=r.get("best_value_store_url"),
                best_value_unit_price=r.get("best_value_unit_price"),
                best_value_unit=r.get("best_value_unit"),
            )
            for r in results
        ]
    )

# Price Agent — Backend Integration Guide

This guide tells you exactly what to add to the backend to expose the price agent as a FastAPI endpoint. No existing files are changed beyond `main.py` (two small additions).

---

## Overview

You will create one new module: `backend/app/prices/` with three files.  
You will also make two small edits to `backend/app/main.py`.

```
backend/app/prices/
    __init__.py       ← empty
    schemas.py        ← request + response Pydantic models
    router.py         ← POST /prices/search endpoint
backend/app/main.py   ← add price-agent to sys.path shim + mount router
```

---

## Step 1 — Add the price-agent to the sys.path shim in `main.py`

Open `backend/app/main.py`. Find the loop at the top that inserts AI agent folders into `sys.path`:

```python
for _folder in ("image-agent", "cookbook-agent", "recipe-photo-agent", "meal-plan-agent"):
```

Add `"price-agent"` to it:

```python
for _folder in ("image-agent", "cookbook-agent", "recipe-photo-agent", "meal-plan-agent", "price-agent"):
```

This makes `price_agent`, `price_agent_dummy`, and `price_config` importable as top-level modules, exactly like the other agents.

---

## Step 2 — Mount the router in `main.py`

At the top of `main.py`, add the import alongside the other routers:

```python
from .prices.router import router as prices_router
```

At the bottom where routers are mounted, add:

```python
app.include_router(prices_router)
```

---

## Step 3 — Create `backend/app/prices/__init__.py`

Empty file — just marks the folder as a Python package.

```python
# empty
```

---

## Step 4 — Create `backend/app/prices/schemas.py`

```python
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class PriceSearchRequest(BaseModel):
    items: list[str] = Field(default_factory=list)
    use_low_stock: bool = False

    @model_validator(mode="after")
    def _at_least_one_source(self):
        if not self.items and not self.use_low_stock:
            raise ValueError("provide 'items' or set 'use_low_stock' to true")
        return self


class StorePriceOut(BaseModel):
    store_url: str
    store_name: str
    price: Optional[float]
    currency: str
    product_url: Optional[str]
    product_name_as_found: Optional[str]
    unit_price: Optional[float]
    unit: Optional[str]


class ItemPriceOut(BaseModel):
    item: str
    prices: list[StorePriceOut]
    cheapest_store_url: Optional[str]
    cheapest_price: Optional[float]
    best_value_store_url: Optional[str]
    best_value_unit_price: Optional[float]
    best_value_unit: Optional[str]


class PriceSearchResponse(BaseModel):
    results: list[ItemPriceOut]
```

---

## Step 5 — Create `backend/app/prices/router.py`

```python
import os

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

# Set PRICE_AGENT_DUMMY=true in .env to use the cheap Haiku mock (no web search,
# fake prices). Unset or false uses the real Sonnet + web-search agent.
if os.getenv("PRICE_AGENT_DUMMY", "").lower() in ("1", "true", "yes"):
    from price_agent_dummy import search_grocery_prices
else:
    from price_agent import search_grocery_prices

from price_config import STORE_URLS

from ..auth.deps import CurrentUser, require_role
from ..supabase_client import get_supabase
from .schemas import ItemPriceOut, PriceSearchRequest, PriceSearchResponse, StorePriceOut

router = APIRouter(prefix="/prices", tags=["prices"])


def _caller_household_id(sb, user_id: str) -> str:
    row = sb.table("users").select("household_id").eq("id", user_id).single().execute()
    if not row.data or not row.data.get("household_id"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Caller is not in a household")
    return row.data["household_id"]


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
    summary="Search grocery prices across stores (admin only)",
)
async def search_prices(
    body: PriceSearchRequest,
    admin: CurrentUser = Depends(require_role("admin")),
):
    """Search grocery prices across the default UAE stores via the price agent.

    Supply `items` directly, set `use_low_stock: true` to pull names from
    the household's low-stock flags, or both (lists are merged and
    de-duplicated). Returns one result entry per item with per-store prices,
    the cheapest store, and the best value per unit.

    Per-store `price: null` is normal — it means the agent could not confirm
    a price at that store this run. A 502 is only raised when every single
    price across every item and store is null (complete agent failure).

    Errors: 401 missing/invalid bearer. 403 caller is not admin or not in a
    household. 422 no items provided. 502 total agent failure (all nulls).
    """
    sb = get_supabase()
    household_id = _caller_household_id(sb, admin.id)

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
```

---

## Step 6 — Environment variables

Make sure your `.env` has `ANTHROPIC_API_KEY` set (it is already in `Settings` in `backend/app/settings.py`).

To test with the dummy agent (no web search, fake prices, near-zero cost):

```env
PRICE_AGENT_DUMMY=true
```

Remove the line or set it to `false` to switch back to the real agent.

---

## Endpoint summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/prices/search` | Admin bearer token | Run the price agent and return per-item, per-store prices |

### Request body

```json
{
  "items": ["milk 1L", "eggs 12pcs"],
  "use_low_stock": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | `list[str]` | One of the two | Explicit list of item names to price |
| `use_low_stock` | `bool` | One of the two | When `true`, pulls names from `low_stock_flags` for the household and merges with `items` |

At least one of `items` (non-empty) or `use_low_stock: true` must be provided, otherwise 422.

### Response `200`

```json
{
  "results": [
    {
      "item": "milk 1L",
      "prices": [
        {
          "store_url": "https://www.spinneys.com/en-ae/",
          "store_name": "Spinneys",
          "price": 6.50,
          "currency": "AED",
          "product_url": null,
          "product_name_as_found": "Almarai Full Fat Milk 1L",
          "unit_price": 0.65,
          "unit": "AED/100ml"
        }
      ],
      "cheapest_store_url": "https://www.carrefouruae.com",
      "cheapest_price": 4.29,
      "best_value_store_url": "https://www.carrefouruae.com",
      "best_value_unit_price": 0.429,
      "best_value_unit": "AED/100ml"
    }
  ]
}
```

### Error codes

| Code | Meaning |
|---|---|
| `401` | Missing or invalid bearer token |
| `403` | Caller is not an admin, or is not in a household |
| `422` | No items provided (both `items` is empty and `use_low_stock` is false) |
| `502` | Price agent returned all-null prices (total failure) — safe to retry |

---

## How the stores list is determined

The agent always uses `STORE_URLS` from `ai_agents/price-agent/price_config.py` — the four hardcoded UAE stores (Spinneys, Carrefour UAE, Union Coop, LuLu Hypermarket). These match the agent's internal search strategy. The household `stores` table is not used here — that table is for display and future expansion.

---

## Notes for testing

1. Start with `PRICE_AGENT_DUMMY=true` — the dummy uses Haiku and returns fake prices instantly. Wire up the full flow (auth, DB, response shape) before spending money on real web search.
2. The agent call is blocking I/O (~10–30s for the real agent). It is always called via `run_in_threadpool` so FastAPI's event loop is not blocked.
3. Per-store `price: null` in the response is **normal** — not an error. Only a 502 means a total failure worth alerting on.
4. The agent batches automatically — no need to split large item lists before calling.

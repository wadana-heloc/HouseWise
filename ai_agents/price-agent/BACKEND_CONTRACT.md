# Price Agent — Backend Contract

This document defines how the backend calls the price agent, what it must pass in, and exactly what it will receive back.

---

## How to Call It

```python
from price_agent import search_grocery_prices
from price_config import STORE_URLS

results = search_grocery_prices(items=["milk 1L", "eggs 12pcs"], stores=STORE_URLS)
```

**Always import `STORE_URLS` from `price_config`** — do not hardcode store URLs. `STORE_URLS` is the canonical list that matches the agent's internal search strategy. Passing different URL variants will cause a mismatch between what the model searches and what appears in the output.

The function is **synchronous and blocking**. It makes one or more Anthropic API calls (with web search) and returns only when all results are ready. Call it from a background job or task queue — never from a request handler directly.

---

## Input

### `items` — `list[str]`

A list of grocery item strings to search for.

| Rule | Detail |
|---|---|
| Type | `list[str]` |
| Min length | 1 |
| Max length | No hard limit — batched automatically at 15 items per API call |
| Item format | Plain English description; include quantity/unit where relevant |

**Examples:**
```python
["milk 1L", "eggs 12pcs", "basmati rice 5kg", "kinder bueno"]
```

---

### `stores` — `list[str]`

Pass `STORE_URLS` from `price_config`. The four supported stores and their canonical URLs are:

```python
from price_config import STORE_URLS

# STORE_URLS expands to:
[
    "https://www.spinneys.com/en-ae/",
    "https://www.carrefouruae.com",
    "https://www.unioncoop.ae",
    "https://gcc.luluhypermarket.com/en-ae",
]
```

These exact strings are what will appear in `store_url` fields in the output. If you pass a different variant (e.g. `https://www.spinneys.com`), the output `store_url` values will not match.

---

## Output

### Return type: `list[dict]`

One dict per item. The list is in the **same order as `items`**. Every store in `stores` appears in every item's `prices` list.

### Full schema (one element):

```json
{
  "item": "milk 1L",
  "prices": [
    {
      "store_url": "https://www.spinneys.com/en-ae/",
      "store_name": "Spinneys",
      "price": 5.50,
      "currency": "AED",
      "product_url": "https://www.spinneys.com/en-ae/catalogue/almarai-full-fat-milk-1l/",
      "product_name_as_found": "Almarai Full Fat Milk 1L",
      "unit_price": 0.55,
      "unit": "AED/100ml"
    },
    {
      "store_url": "https://www.carrefouruae.com",
      "store_name": "Carrefour UAE",
      "price": 4.29,
      "currency": "AED",
      "product_url": "https://www.carrefouruae.com/mafuae/en/uht-milk-full-fat/p/2190706",
      "product_name_as_found": "Carrefour Long Life UHT Full Fat Milk 1L",
      "unit_price": 0.429,
      "unit": "AED/100ml"
    },
    {
      "store_url": "https://www.unioncoop.ae",
      "store_name": "Union Coop",
      "price": null,
      "currency": "AED",
      "product_url": null,
      "product_name_as_found": null,
      "unit_price": null,
      "unit": null
    },
    {
      "store_url": "https://gcc.luluhypermarket.com/en-ae",
      "store_name": "LuLu Hypermarket",
      "price": 4.75,
      "currency": "AED",
      "product_url": "https://gcc.luluhypermarket.com/en-ae/milk/p/123456",
      "product_name_as_found": "Almarai Long Life Full Fat Milk 1L",
      "unit_price": 0.475,
      "unit": "AED/100ml"
    }
  ],
  "cheapest_store_url": "https://www.carrefouruae.com",
  "cheapest_price": 4.29,
  "best_value_store_url": "https://www.carrefouruae.com",
  "best_value_unit_price": 0.429,
  "best_value_unit": "AED/100ml"
}
```

---

## Field Reference

### Per-item fields

| Field | Type | Nullable | Description |
|---|---|---|---|
| `item` | `str` | No | The item string as passed in |
| `prices` | `list[dict]` | No | One entry per store — always 4 entries when using `STORE_URLS` |
| `cheapest_store_url` | `str \| null` | Yes | `store_url` of the lowest raw price. `null` if all prices are null |
| `cheapest_price` | `float \| null` | Yes | The lowest raw price in AED. `null` if all prices are null |
| `best_value_store_url` | `str \| null` | Yes | `store_url` with the lowest unit price. Falls back to `cheapest_store_url` if no unit prices are available. `null` only if all prices are also null |
| `best_value_unit_price` | `float \| null` | Yes | The lowest unit price. `null` if no unit prices could be determined |
| `best_value_unit` | `str \| null` | Yes | Unit string for `best_value_unit_price`, e.g. `"AED/100ml"`, `"AED/kg"`, `"AED/piece"`. `null` if `best_value_unit_price` is null |

> **`cheapest` vs `best_value`:** `cheapest_price` is the lowest raw price — use this for headline display. `best_value_unit_price` is the lowest price-per-unit — use this when comparing value across stores that may sell different pack sizes. They will often point to the same store, but not always (e.g. a 5kg bag at one store vs a 1kg bag at another).

> **`best_value_store_url` fallback:** if the model cannot determine any unit prices (all `unit_price` fields are null), `best_value_store_url` falls back to the same store as `cheapest_store_url`. In this case `best_value_unit_price` and `best_value_unit` will still be null.

---

### Per-store fields (`prices[]`)

| Field | Type | Nullable | Description |
|---|---|---|---|
| `store_url` | `str` | No | Exactly matches the URL passed in `stores` |
| `store_name` | `str` | No | Human-readable store name e.g. `"Spinneys"`, `"Carrefour UAE"` |
| `price` | `float \| null` | Yes | Raw price in AED. `null` if not found this run |
| `currency` | `str` | No | Always `"AED"` |
| `product_url` | `str \| null` | Yes | Direct URL to the product page where the price was found. `null` if not found |
| `product_name_as_found` | `str \| null` | Yes | Exact product name from the source. `null` if not found |
| `unit_price` | `float \| null` | Yes | Price per standard unit. `null` if pack size cannot be determined |
| `unit` | `str \| null` | Yes | Unit for `unit_price`. `null` if `unit_price` is null |

---

### Unit calculation rules

Unit prices are computed by the model and normalised consistently across stores:

| Item type | Unit | Example |
|---|---|---|
| Liquids (milk, juice, oil) | `AED/100ml` | 500ml at AED 25 → `unit_price: 5.0` |
| Dry goods by weight (rice, flour, sugar) | `AED/kg` | 5kg at AED 30 → `unit_price: 6.0` |
| Items sold by count (eggs) | `AED/piece` | 12 eggs at AED 12 → `unit_price: 1.0` |
| Snacks / confectionery | `AED/100g` | 43g bar at AED 6.5 → `unit_price: 15.12` |
| Fresh produce | `AED/kg` | Cucumber per kg at AED 3.5 → `unit_price: 3.5` |
| Unknown size | `null` | `unit_price: null`, `unit: null` |

---

## Null Handling

The backend **always receives a response** — the agent never raises an exception to the caller. When a price cannot be found or the API response cannot be parsed, the agent returns a null-filled entry for that item:

```json
{
  "item": "some item",
  "prices": [
    {
      "store_url": "https://www.spinneys.com/en-ae/",
      "store_name": "https://www.spinneys.com/en-ae/",
      "price": null,
      "currency": "AED",
      "product_url": null,
      "product_name_as_found": null,
      "unit_price": null,
      "unit": null
    }
  ],
  "cheapest_store_url": null,
  "cheapest_price": null,
  "best_value_store_url": null,
  "best_value_unit_price": null,
  "best_value_unit": null
}
```

**How to detect a null-fallback result:** `store_name` equals `store_url` (the raw URL string). In a successful result `store_name` is always a short human name like `"Spinneys"`. If all entries have `store_name == store_url`, the entire response is a fallback — treat it as a failed call and retry or skip.

**A per-store null is normal.** A single store having `price: null` while others have prices is expected — it means the agent could not confirm a price at that store this run, not that the item is unavailable there. See `LIMITATIONS.md` for why this happens.

---

## Batching Behaviour

The agent batches automatically — the backend does not need to handle this.

| Items count | API calls made |
|---|---|
| 1–15 | 1 call |
| 16–30 | 2 calls |
| 31–45 | 3 calls |
| N items | `ceil(N / 15)` calls |

Results from all batches are merged into a single flat list before returning, in the same order as the input `items`.

---

## Environment Variable

The agent requires `ANTHROPIC_API_KEY` to be set in the environment before calling the function.

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Worked Example

```python
from price_agent import search_grocery_prices
from price_config import STORE_URLS

results = search_grocery_prices(
    items=["basmati rice", "milk 1L"],
    stores=STORE_URLS,
)

for entry in results:
    print(f"{entry['item']}")
    print(f"  cheapest : {entry['cheapest_price']} AED at {entry['cheapest_store_url']}")
    print(f"  best value: {entry['best_value_unit_price']} {entry['best_value_unit']} at {entry['best_value_store_url']}")
    for p in entry["prices"]:
        print(f"  {p['store_name']}: {p['price']} AED — {p['product_name_as_found']}")
```

---

## What the Agent Does NOT Do

- Does not store results — persistence is the backend's responsibility
- Does not guarantee prices are current — data comes from web search and may be hours old
- Does not flag whether a price is promotional or regular
- Does not validate store URLs — always pass `STORE_URLS` from `price_config`
- Does not maintain state between calls — fully stateless
- Does not raise exceptions on failure — returns null-filled results instead (see null handling above)

See `LIMITATIONS.md` for a full breakdown of known limitations and recommended workarounds.

# Price Agent — Backend Contract

This document defines how the backend calls the price agent, what it must pass in, and exactly what it will receive back.

---

## How to Call It

```python
from price_agent import search_grocery_prices

results = search_grocery_prices(items, stores)
```

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
| Item format | Plain English description, include quantity/unit where relevant |

**Examples:**
```python
["milk 1L", "eggs 12pcs", "basmati rice 5kg", "kinder bueno"]
```

---

### `stores` — `list[str]`

A list of store URLs. These are used as output keys — results are mapped back to these exact URLs.

| Rule | Detail |
|---|---|
| Type | `list[str]` |
| Format | Full URL with scheme, e.g. `https://www.carrefouruae.com` |
| Min length | 1 |
| Validation | Not validated by the agent — pass correct URLs from the backend |

**Supported UAE stores (tested):**
```python
[
    "https://www.carrefouruae.com",
    "https://www.spinneys.com",
    "https://www.unioncoop.com",
    "https://www.luluhypermarket.com"
]
```

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
      "store_url": "https://www.carrefouruae.com",
      "store_name": "Carrefour UAE",
      "price": 4.29,
      "currency": "AED",
      "product_url": "https://www.carrefouruae.com/mafuae/en/uht-milk-full-fat/crf-uht-milk-full-f-1l/p/2190706",
      "product_name_as_found": "Carrefour Long Life UHT Full Fat Milk 1L",
      "unit_price": 0.429,
      "unit": "AED/100ml"
    },
    {
      "store_url": "https://www.spinneys.com",
      "store_name": "Spinneys",
      "price": 5.50,
      "currency": "AED",
      "product_url": "https://www.spinneys.com/en-ae/catalogue/almarai-full-fat-milk-1l_12345/",
      "product_name_as_found": "Almarai Full Fat Milk 1L",
      "unit_price": 0.55,
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

### Field reference:

#### Per-item fields

| Field | Type | Nullable | Description |
|---|---|---|---|
| `item` | `str` | No | The item string as passed in (may be capitalised by the model) |
| `prices` | `list[dict]` | No | One entry per store — always present, never an empty list |
| `cheapest_store_url` | `str \| null` | Yes | `store_url` of the lowest raw price. `null` if all prices are null |
| `cheapest_price` | `float \| null` | Yes | The lowest raw price in AED. `null` if all prices are null |
| `best_value_store_url` | `str \| null` | Yes | `store_url` with the lowest unit price (best price per kg/L/piece). `null` if no unit prices found |
| `best_value_unit_price` | `float \| null` | Yes | The lowest unit price. `null` if no unit prices found |
| `best_value_unit` | `str \| null` | Yes | The unit used for comparison, e.g. `"AED/100ml"`, `"AED/kg"`, `"AED/piece"`. `null` if not found |

#### Per-store fields (`prices[]`)

| Field | Type | Nullable | Description |
|---|---|---|---|
| `store_url` | `str` | No | Exactly matches the URL passed in `stores` |
| `store_name` | `str` | No | Human-readable store name inferred by the model (e.g. `"Spinneys"`) |
| `price` | `float \| null` | Yes | Raw price in AED for the product found. `null` if not found |
| `currency` | `str` | No | Always `"AED"` |
| `product_url` | `str \| null` | Yes | Direct URL to the product page. `null` if not found |
| `product_name_as_found` | `str \| null` | Yes | Exact product name from the source. `null` if not found |
| `unit_price` | `float \| null` | Yes | Price per standard unit (e.g. per 100ml, per kg, per piece). `null` if size cannot be determined |
| `unit` | `str \| null` | Yes | Unit string for `unit_price`, e.g. `"AED/100ml"`, `"AED/kg"`, `"AED/piece"`. `null` if `unit_price` is null |

#### Unit calculation rules

The agent normalises units consistently across stores so `unit_price` values are always directly comparable:

| Item type | Unit used | Example |
|---|---|---|
| Liquids (milk, juice, oil) | `AED/100ml` | 500ml at AED 25 → `unit_price: 5.0` |
| Dry goods by weight (rice, flour) | `AED/kg` | 5kg at AED 30 → `unit_price: 6.0` |
| Items sold by count (eggs) | `AED/piece` | 12 eggs at AED 12 → `unit_price: 1.0` |
| Snacks/confectionery | `AED/100g` | 43g bar at AED 6.5 → `unit_price: 15.12` |

> **`cheapest` vs `best_value`:** `cheapest_price` is the lowest raw price — useful when the backend displays a headline price. `best_value_unit_price` is the lowest price-per-unit — use this for value comparison when the same item may be sold in different sizes across stores.

---

## Null Handling

The backend **must always receive a response** — the agent never raises an exception to the caller. When a price cannot be found or the API response cannot be parsed, the agent returns a null-filled entry for that item:

```json
{
  "item": "some item",
  "prices": [
    {
      "store_url": "https://www.carrefouruae.com",
      "store_name": "https://www.carrefouruae.com",
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

**How to detect a null-fallback result:** `store_name` equals `store_url` (the raw URL). In a successful result, `store_name` is always a short human-readable name like `"Spinneys"`.

---

## Batching Behaviour

The agent batches automatically — the backend does not need to handle this.

| Items count | API calls made |
|---|---|
| 1–15 | 1 call |
| 16–30 | 2 calls |
| 31–45 | 3 calls |
| N items | `ceil(N / 15)` calls |

Results from all batches are merged into a single flat list before returning.

---

## Environment Variable

The agent requires `ANTHROPIC_API_KEY` to be set in the environment before `search_grocery_prices` is imported.

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

If the key is missing the agent will raise `anthropic.AuthenticationError` at import time.

---

## Worked Example

```python
from price_agent import search_grocery_prices

results = search_grocery_prices(
    items=["kinder bueno", "milk 1L"],
    stores=[
        "https://www.spinneys.com",
        "https://www.carrefouruae.com"
    ]
)

for entry in results:
    print(f"{entry['item']}")
    print(f"  cheapest raw price : {entry['cheapest_price']} AED at {entry['cheapest_store_url']}")
    print(f"  best value per unit: {entry['best_value_unit_price']} {entry['best_value_unit']} at {entry['best_value_store_url']}")
```

**Expected output:**
```
Kinder Bueno
  cheapest raw price : 6.5 AED at https://www.spinneys.com
  best value per unit: 15.12 AED/100g at https://www.spinneys.com
milk 1L
  cheapest raw price : 4.29 AED at https://www.carrefouruae.com
  best value per unit: 0.429 AED/100ml at https://www.carrefouruae.com
```

---

## What the Agent Does NOT Do

- Does not store results — persistence is the backend's responsibility
- Does not validate store URLs — pass correct URLs
- Does not maintain state between calls — fully stateless
- Does not guarantee prices are real-time — prices are sourced from web search results which may be hours or days old

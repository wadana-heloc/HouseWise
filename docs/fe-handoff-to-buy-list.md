# FE handoff — to-buy list endpoints

**Date:** 2026-06-21
**Scope:** the buying-decision flow you described — admin selects items, runs the price agent, picks store + price per item, saves to the to-buy list. Family + admin can mark items bought from either the to-buy screen or the active-items screen; the two lists stay in sync.

---

## New endpoints

| Method | Path | Caller | Purpose |
| --- | --- | --- | --- |
| POST | `/prices/search` | admin | Run the price agent for a list of items across UAE stores. Body: `{items: string[], use_low_stock: boolean}`. Returns per-item per-store prices. Per-store `null` is normal; total failure → 502. Set `PRICE_AGENT_DUMMY=true` in backend env to use the cheap mock during dev. |
| POST | `/to-buy` | admin | **Replace** the household's to-buy list. Body: `{entries: ToBuyEntryIn[]}`. Empty entries = clears. |
| GET | `/to-buy` | any member | Get the household's current to-buy list with item info joined + `estimated_total`. |
| POST | `/to-buy/{entry_id}/done` | any member | Mark an entry bought. **Also marks the underlying items row as `done`.** |
| DELETE | `/to-buy/{entry_id}` | admin | Remove an entry without marking it bought (admin changed their mind). |

---

## End-to-end flow (the one you described)

```
┌────────────────────────────────────────┐
│ Admin: "Generate report" screen        │
│ 1. FE: GET /items?status=approved      │  (or also pending — both are pickable)
│    + GET /items?status=pending         │
│ 2. Admin checks N items.               │
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│ FE concatenates selected items:        │
│   "Milk 2L"                            │  ← name + " " + qty + unit
│   "Eggs 12pcs"                         │
│                                        │
│ FE: POST /prices/search                │
│   { items: [...], use_low_stock: false}│
│                                        │
│ Wait ~10–30s (real agent) or instant   │
│ (dummy). Backend may take >10s — show  │
│ a progress spinner.                    │
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│ Admin: "Pick what to buy + where"      │
│ Shows per-item per-store prices.       │
│ Admin chooses one store per item.      │
│ (Admin can also skip items entirely.)  │
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│ FE: POST /to-buy                        │
│   { entries: [                          │
│       { item_id, chosen_store_url,      │
│         chosen_store_name,              │
│         chosen_price, currency }, ...   │
│     ]                                   │
│   }                                     │
│ Backend wipes the old list and inserts. │
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│ To-buy screen (any member can see)     │
│ FE: GET /to-buy → render entries +     │
│      estimated_total                   │
└──────────────────┬─────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   Buy via to-buy        Buy via items
   screen:               screen:
   POST /to-buy/{id}     POST /items/{id}/status
   /done                 with {status:"done"}
        │                     │
        ▼                     ▼
   item→done                  to-buy entry deleted
   to-buy entry deleted       (cross-sync, Direction A)
   (cross-sync, Direction B)
```

---

## Request / response shapes

### `POST /prices/search`

Request:
```json
{
  "items": ["Milk 2L", "Eggs 12pcs"],
  "use_low_stock": false
}
```

Per-item items in the list must be **non-empty after trimming** (whitespace-only → 422). FE concatenates `item.name + " " + item.quantity + item.unit` (e.g. `"Milk 2L"`) — gives the agent better hit rates than the bare name.

Response (200):
```json
{
  "results": [
    {
      "item": "Milk 2L",
      "prices": [
        {
          "store_url": "https://www.spinneys.com/en-ae/",
          "store_name": "Spinneys",
          "price": 8.50,
          "currency": "AED",
          "product_url": "https://www.spinneys.com/...",
          "product_name_as_found": "Almarai Full Fat Milk 2L",
          "unit_price": 0.43,
          "unit": "AED/100ml"
        },
        {
          "store_url": "https://www.carrefouruae.com",
          "store_name": "Carrefour UAE",
          "price": null,
          "currency": "AED",
          "product_url": null,
          "product_name_as_found": null,
          "unit_price": null,
          "unit": null
        }
      ],
      "cheapest_store_url": "https://www.spinneys.com/en-ae/",
      "cheapest_price": 8.50,
      "best_value_store_url": "https://www.spinneys.com/en-ae/",
      "best_value_unit_price": 0.43,
      "best_value_unit": "AED/100ml"
    }
  ]
}
```

- **Per-store `price: null` is normal** — the agent didn't find a confirmed price at that store this run. Show it as "—" or "N/A" in the UI; don't treat as an error.
- **502** is raised only when **every price across every item and every store is null** (total agent failure). Safe to retry once.
- **503** if the agent module isn't packaged in this deployment.

### `POST /to-buy`

Request:
```json
{
  "entries": [
    {
      "item_id": "uuid-of-an-existing-items-row",
      "chosen_store_url": "https://www.spinneys.com/en-ae/",
      "chosen_store_name": "Spinneys",
      "chosen_price": "8.50",
      "currency": "AED"
    }
  ]
}
```

Field notes:
- `item_id` must belong to the caller's household AND have status `pending` or `approved`. Anything else → 409 naming the offending item id + status. Unknown id → 404.
- `chosen_price` is decimal-as-string (same precision contract as `items.quantity`). Send `"8.50"`, not `8.50`. Backend stores `numeric(10,2)`.
- `currency` defaults to `"AED"` if omitted. Don't mix currencies in one list (v1 only renders one currency in the email).
- **Empty `entries` is allowed** and clears the list. Useful for an "abandon shopping trip" action.

Response (200): the new `ToBuyListOut` (same shape as `GET /to-buy`).

### `GET /to-buy`

Response (200):
```json
{
  "entries": [
    {
      "id": "to-buy-entry-uuid",
      "household_id": "...",
      "item_id": "items-row-uuid",
      "item_name": "Milk 2L",
      "quantity": "1",
      "unit": "L",
      "chosen_store_url": "https://www.spinneys.com/en-ae/",
      "chosen_store_name": "Spinneys",
      "chosen_price": "8.50",
      "currency": "AED",
      "snapshot_at": "2026-06-21T11:42:00Z",
      "added_by": "admin-user-uuid",
      "created_at": "2026-06-21T11:42:00Z",
      "updated_at": "2026-06-21T11:42:00Z"
    }
  ],
  "item_count": 1,
  "estimated_total": "8.50",
  "currency": "AED"
}
```

- `item_name`, `quantity`, `unit` are **joined from the items row at read time** — they reflect the current item, not what was snapshotted (item names can be edited per FR-017 while still pending, so the display name might change after the to-buy entry was created).
- `chosen_price` and `chosen_store_*` are frozen at save time — they reflect the buying decision, not the latest market price.
- `quantity` and `chosen_price` and `estimated_total` are **strings** (decimals-as-strings, same as `items.quantity` per BUG-007). `parseFloat` on the FE if you need numeric ops.

### `POST /to-buy/{entry_id}/done`

No body. Returns `{"ok": true}`. Side effects:
- Underlying `items.status` → `'done'`.
- To-buy entry deleted.

### `DELETE /to-buy/{entry_id}`

No body. Returns `{"ok": true}`. Removes only the to-buy row; the items row keeps its current status (likely `pending` or `approved`, so it's still on the active list and available to re-add to a future to-buy list).

---

## Cross-list sync — what it means for your UI

The two lists are kept in sync at the application layer. Any of these actions resolves both lists:

| Action | Items row | To-buy entry |
| --- | --- | --- |
| `POST /to-buy/{id}/done` | → `status='done'` | → deleted |
| `POST /items/{id}/status` `{status:"done"}` | → `status='done'` | → deleted (if it existed) |
| `DELETE /to-buy/{id}` | unchanged | → deleted |
| Any other `items.status` transition (pending/in_review/approved/rejected) | → new status | unchanged |

**Practical UI implication:** if you show both the to-buy list and the active items list on the same screen (or refresh either after an action), trust the backend response — don't try to predict the cross-sync side effect locally. Just re-fetch the list you're showing after any of the above actions, or pop the affected row from local state and trust that the other screen will refresh next time it's opened.

**A subtle case:** a family member ticks "bought" on the active-items screen for an item the admin had added to the to-buy list. The next time the admin opens the to-buy screen, that entry is gone. That's the intended sync — no surprise drift.

---

## Item picker — which items show up

The admin's "Generate report" picker should show items where `status` is `pending` or `approved`. Don't show `in_review`, `rejected`, or `done` items — the backend will 409 if you try to add them. Suggested query:

```ts
const [pending, approved] = await Promise.all([
  api.get('/items?status=pending'),
  api.get('/items?status=approved'),
]);
const pickable = [...approved.items, ...pending.items];
```

The locked design lets admin pick pending items so they can price-check before approving. Pending items added to the to-buy list **stay pending in the items table** — picking them isn't an approval action. They jump straight to `done` when bought.

---

## Replace-on-regenerate — show a confirmation modal

`POST /to-buy` always replaces the entire list (no merge). If the admin clicks "Generate report" while there are un-bought items on the existing list, **show a confirmation modal first**:

> "You have 8 items on your shopping list. Generating a new list will replace them. Continue?"

Backend cannot warn because the call is stateless — by the time the new POST hits, the old list is gone. FE owns this guard.

If admin confirms, send the new POST. If they cancel, do nothing.

---

## Empty-state UX

If `GET /to-buy` returns `{item_count: 0, entries: [], estimated_total: "0", currency: "AED"}`, show an empty state: "Your shopping list is empty. Tap 'Generate report' to start a new shopping trip."

The same empty payload is what the cron will see when deciding whether to email this household — an empty list means **no email is sent that week**. No need to tell the admin that; just don't surface "your weekly report didn't go out" as a warning. Skipped sends are normal.

---

## Quick test (after backend deploy + migration 0015 applied)

```bash
TOKEN=$ADMIN_TOKEN
BASE=...

# 1. Create two items
I1=$(curl -sS -X POST $BASE/items -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Milk","category":"dairy","quantity":1,"unit":"L"}' | jq -r .id)
I2=$(curl -sS -X POST $BASE/items -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bread","category":"bakery","quantity":1,"unit":"loaves"}' | jq -r .id)

# 2. Replace the to-buy list with both
curl -sS -X POST $BASE/to-buy -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entries\":[
    {\"item_id\":\"$I1\",\"chosen_store_url\":\"https://www.spinneys.com/en-ae/\",\"chosen_store_name\":\"Spinneys\",\"chosen_price\":\"5.50\",\"currency\":\"AED\"},
    {\"item_id\":\"$I2\",\"chosen_store_url\":\"https://www.carrefouruae.com\",\"chosen_store_name\":\"Carrefour UAE\",\"chosen_price\":\"3.00\",\"currency\":\"AED\"}
  ]}"

# 3. GET the list
curl -sS $BASE/to-buy -H "Authorization: Bearer $TOKEN"

# 4. Mark the first one done; observe item also done + entry gone
E1=$(curl -sS $BASE/to-buy -H "Authorization: Bearer $TOKEN" | jq -r '.entries[0].id')
curl -sS -X POST $BASE/to-buy/$E1/done -H "Authorization: Bearer $TOKEN"
curl -sS $BASE/items/$I1 -H "Authorization: Bearer $TOKEN" | jq .status   # → "done"
curl -sS $BASE/to-buy -H "Authorization: Bearer $TOKEN" | jq .item_count   # → 1

# 5. Mark the second item done via the items endpoint; observe to-buy entry gone (Direction A)
curl -sS -X POST $BASE/items/$I2/status -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"status":"done"}'
curl -sS $BASE/to-buy -H "Authorization: Bearer $TOKEN" | jq .item_count   # → 0
```

---

## Rollback

The change is additive — new endpoints + new table. If anything blocks an FE flow we need to roll back, the rollback is removing the `to_buy_router` mount in `main.py` and the sync line in `items/router.py`'s `update_status`. The `to_buy_list` table can stay; it'll just sit unused. Tell me and I'll back out the wiring.

— Belal

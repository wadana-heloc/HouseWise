# To-buy list flow

The household's **frozen buying decision** for a shopping trip. Distinct from `/items` (the open active list): admin picks items off the active list, runs the price agent ([scan-image-flow.md](scan-image-flow.md) parallel), and saves the chosen store + price per item as a to-buy entry. The list represents *what the admin is going to buy and where*.

Bidirectional sync with `items.status='done'` keeps the two lists from drifting — marking bought on either side updates the other.

---

## Resource

`public.to_buy_list` — see [supabase/migrations/0015_to_buy_list.sql](../supabase/migrations/0015_to_buy_list.sql). Highlights:

- `household_id` — every entry belongs to one household. FK cascades on household delete.
- `item_id` — FK → `public.items(id)` ON DELETE CASCADE. Hard requirement: one items row per to-buy entry.
- `chosen_store_url`, `chosen_store_name`, `chosen_price`, `currency` — **frozen snapshot** at the moment admin saved the entry. Does not update if prices move later.
- `snapshot_at` — when the price was captured (for "prices as of X" wording in the email).
- `added_by` — `auth.users.id` of the admin who saved the entry; `ON DELETE SET NULL`.
- `unique (household_id, item_id)` — one to-buy entry per item per household. Replace-on-regenerate semantics enforce this at the application layer; the DB constraint is the safety net.
- RLS: authenticated clients can `SELECT` their own household's entries only; all writes via the backend with `service_role`.

---

## Endpoints

| Method | Path | Caller | Body | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/to-buy` | admin | `ToBuyReplaceRequest` | **Replace** the household's list with `entries`. Empty entries = clear the list. Validates every `item_id` is in the household + status is `pending` or `approved`. |
| GET | `/to-buy` | any member | — | List entries with item info joined (`item_name`, `quantity`, `unit`) + aggregate `estimated_total`. |
| POST | `/to-buy/{entry_id}/done` | any member | — | Mark entry bought. Atomically flips `items.status='done'` **and** deletes the entry (Direction B sync). |
| DELETE | `/to-buy/{entry_id}` | admin | — | Remove entry without marking the item bought. Does not touch `items.status`. |

Cross-household access is always **404** (not 403) so existence isn't leaked.

---

## Lifecycle

```
                    POST /prices/search
                  (price agent returns prices
                    across UAE stores)
                            │
                            ▼
                    Admin picks N items + chosen store/price each
                            │
                            ▼
                    POST /to-buy {entries: [...]}
                  (wipes old entries; inserts new)
                            │
                            ▼
                        ┌───────┐
                        │ to-buy│  ◄── GET /to-buy (anyone)
                        │  list │
                        └───┬───┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
POST /to-buy/{id}/done   DELETE /to-buy/{id}  POST /items/{item_id}/status
(any member)             (admin only)         with {status: "done"}
        │                   │                   │
        │ items→done        │ items unchanged   │ items→done
        │ to-buy row gone   │ to-buy row gone   │ to-buy row gone (Direction A)
        ▼                   ▼                   ▼
   bought, done           re-pick later      bought, done
```

---

## Bidirectional sync (hard requirement)

The two lists must agree on what's been bought. Two trigger points, both at the application layer (no DB triggers):

### Direction A — items → to_buy_list

`POST /items/{id}/status` with `{status: "done"}` in [backend/app/items/router.py](../backend/app/items/router.py) `update_status`:

1. Existing transition check + UPDATE items.
2. **If the new status is `done`**, also `DELETE FROM to_buy_list WHERE item_id = :id`. Best-effort (no row = no-op).

Triggered when any household member marks an item bought from the active-items screen.

### Direction B — to_buy_list → items

`POST /to-buy/{entry_id}/done` in [backend/app/to_buy/router.py](../backend/app/to_buy/router.py) `mark_done`:

1. `SELECT * FROM to_buy_list WHERE id=… AND household_id=…` → 404 if missing.
2. **`UPDATE items SET status='done' WHERE id=entry.item_id`** (the `_check_transition` matrix already allows any member → `done` from any state).
3. `DELETE FROM to_buy_list WHERE id=entry.id`.
4. Return `OkResponse`.

Triggered when the admin (or any member) marks something bought from the to-buy screen.

### What doesn't auto-sync

- **`DELETE /to-buy/{entry_id}`** — admin removed the entry but didn't buy the item. `items.status` stays unchanged (likely still `approved` or `pending`). Item is back on the active list, available to re-add to a future to-buy list.
- **`POST /items/{id}/status`** with anything other than `done` (`pending`, `in_review`, `approved`, `rejected`) — to-buy entry stays. If the admin moves an item back to `pending` to edit it (per FR-017), the to-buy entry's `chosen_price` snapshot is unaffected; replace-on-regenerate is the way to refresh.
- **Bulk edits via Supabase studio** — these bypass the application layer entirely. If you `update items set status='done'` directly in psql, the matching `to_buy_list` rows won't be cleaned up. Don't do that without manual cleanup. Acceptable v1 trade-off: keeping sync visible at the application layer means anyone reading the code knows where to look.

### Sync invariant for testing

The invariant: **for any item with a `to_buy_list` row, the item's status is NOT `done`.** Stated otherwise: marking `done` on either side always wipes the to-buy row.

Tests that pin this down:
- `test_to_buy_done_also_flips_items_status` — POST `/to-buy/{id}/done`, then GET `/items/{item_id}` returns `status='done'`.
- `test_items_status_done_also_clears_to_buy` — POST `/items/{id}/status` with `done`, then GET `/to-buy` does not include that item.
- `test_delete_to_buy_does_not_change_item_status` — DELETE `/to-buy/{id}`, then GET `/items/{item_id}` returns the same `status` it had before (not `done`).

---

## Replace-on-regenerate semantics

`POST /to-buy` always **replaces** the entire list. Two-step in the same handler:

1. `DELETE FROM to_buy_list WHERE household_id = :hh`.
2. `INSERT` the new entries.

Trade-offs of this design:

- **Pros:** stateless from the client's POV ("here's the new list"); no merge logic; matches the product mental model of "start a new shopping trip".
- **Cons:** destructive — admin clicks "Generate report" again and loses N un-bought entries. The FE shows a confirmation dialog before sending the new POST.
- **No transactional guarantee** between delete and insert. There's a brief window where the table is empty. Admin-only endpoint, low contention, acceptable.
- **History is lost.** Previous to-buy lists are not archived; no audit table. If product wants history later, a separate table would track it; out of scope for v1.

Empty `entries` list is allowed and clears the table — admin can wipe everything via the same endpoint.

---

## Item eligibility for picking

`POST /to-buy` validates every `item_id` is in the household AND `items.status` is in `{pending, approved}`. Locked product call (see plan): admin can pick items that haven't been formally approved yet, so they can price-check before approving.

Rejected:
- **Cross-household item_id** → 404 `{"detail":"Item <id> not in your household"}`.
- **`in_review` / `rejected` / `done` item** → 409 `{"detail":"Item <id> has status '<X>'. Only pending or approved items can be added to the to-buy list."}`.

Note: a `pending` item that ends up on the to-buy list *stays* `pending` in the items table — adding to to-buy is not an approval action. When someone marks it done from either side, the items row jumps straight from `pending` → `done` (the `_check_transition` matrix permits any member → `done` from any state).

---

## Email reminder (Phase 3)

A weekly cron will email the admin a reminder containing this list — chosen store + price per item + estimated total + deep link to the to-buy screen. Settings live in `households.report_day` / `report_time` / `report_timezone` (migration 0013). Cron deduplicates via `households.last_report_sent_at` (added in migration 0015). See [cron-and-email-flow.md](cron-and-email-flow.md) once Phase 3 ships.

The cron is a **pure read** — it never mutates `to_buy_list` or `items`. If you mark something bought after the email goes out, the next email reflects the new list.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 404 on POST `/to-buy` | An `item_id` in `entries` isn't in the caller's household | [to_buy/router.py](../backend/app/to_buy/router.py) `replace_to_buy` validation loop |
| 409 on POST `/to-buy` | An item is in `in_review`, `rejected`, or `done` (only `pending`/`approved` are pickable) | same |
| 404 on POST `/to-buy/{id}/done` | Entry not in caller's household, or already deleted | [to_buy/router.py](../backend/app/to_buy/router.py) `mark_done` |
| Orphan entry in GET response | The underlying items row was deleted via Supabase studio without cascading to to_buy_list | [to_buy/router.py](../backend/app/to_buy/router.py) `_list_entries` skips orphans rather than 500 |
| 422 on POST `/to-buy` | Whitespace-only `chosen_store_url` / `chosen_store_name`, negative `chosen_price`, or any extra field (e.g. typo'd key) | [to_buy/schemas.py](../backend/app/to_buy/schemas.py) `ToBuyEntryIn` |
| To-buy entry survived after `items.done` somehow | Bulk edit via Supabase studio bypassed the sync handler | Documented limitation; clean up manually with `DELETE FROM to_buy_list WHERE item_id IN (SELECT id FROM items WHERE status='done')` |

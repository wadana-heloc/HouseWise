# Items flow

Household shopping/inventory list. One row per item per household. Source of truth for fields, enums, and permissions is [supabase/migrations/0004_init_items.sql](../supabase/migrations/0004_init_items.sql) and [backend/app/items/router.py](../backend/app/items/router.py).

Adding an item from a product photo is a **separate pass-through endpoint** that does not persist — the mobile client gets back `{name, brand, size}`, the user confirms, then a normal `POST /items` actually creates the row. See [docs/scan-image-flow.md](scan-image-flow.md).

---

## Resource

`public.items` — see [0004_init_items.sql](../supabase/migrations/0004_init_items.sql) for the canonical schema. Highlights:

- `household_id` — every item belongs to exactly one household. FK cascades on household delete.
- `name`, `category` (enum), `quantity` (numeric(10,3), > 0), `unit` (enum), `urgent` (bool).
- `status` (enum) — see state machine below.
- `notes` — optional free text, ≤ 500 chars.
- `added_by` — `auth.users.id` of the creator. `ON DELETE SET NULL` so deleting a member doesn't cascade-delete the items they added.
- RLS: authenticated clients can `SELECT` their own household's items only; all writes go through the backend with `service_role`.

---

## Endpoints

| Method | Path | Caller | Body | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/items` | any member | `ItemCreate` | Add an item. Server sets `status='pending'` and `added_by=caller`. |
| GET | `/items` | any member | — | List the caller's household items. Filters: `status`, `urgent`, `category`, `added_by`. Order: `urgent desc, created_at desc`. |
| GET | `/items/{id}` | any member | — | Fetch one. 404 if not in caller's household. |
| PATCH | `/items/{id}` | creator or admin | `ItemUpdate` (≥ 1 field) | Update any non-status field. **Only allowed when `status='pending'`** (FR-017); non-pending → 409 for everyone (admin included). |
| POST | `/items/{id}/status` | depends (see matrix) | `ItemStatusUpdate` | Transition `status`. Validated by the rules below. |
| DELETE | `/items/{id}` | creator or admin | — | Permanent delete. **Only allowed when `status='pending'`** (FR-018); non-pending → 409 for everyone. |

---

## Permissions

| Action | admin | family (creator) | family (non-creator) |
| --- | :---: | :---: | :---: |
| Create item | ✓ | ✓ | ✓ |
| List / get any item in household | ✓ | ✓ | ✓ |
| **PATCH (non-status fields), while `status='pending'`** | ✓ | ✓ | ✗ (403) |
| **PATCH non-pending item (any field)** | ✗ (409) | ✗ (409) | ✗ (409) |
| Mark `done` | ✓ | ✓ | ✓ |
| Undo `done → pending` | ✓ | ✓ | ✓ |
| Set `in_review`, `approved`, `rejected` | ✓ | ✗ (403) | ✗ (403) |
| Reopen `rejected → pending` | ✓ | ✗ (403) | ✗ (403) |
| **DELETE, while `status='pending'`** | ✓ | ✓ | ✗ (403) |
| **DELETE non-pending item** | ✗ (409) | ✗ (409) | ✗ (409) |

Cross-household access is always **404** (not 403) so existence isn't leaked.

**Why no admin carve-out on the status gate?** FR-017 says "Edit is blocked for approved or purchased items" with no admin exception. To edit a non-pending item, admin must first move it back to `pending` via `POST /items/{id}/status`, edit, then move it forward again.

---

## Status state machine

```
                      ┌──────────────────────────────┐
                      │            DONE              │
                      └──────────────┬───────────────┘
                              ▲      │ (any member)
              (any member)    │      ▼
                              │
   ┌──────────┐  admin  ┌───────────┐  admin   ┌──────────┐
   │ PENDING  │ ──────▶ │ IN_REVIEW │ ───────▶ │ APPROVED │
   └────┬─────┘         └─────┬─────┘          └────┬─────┘
        │  admin              │  admin              │ (any member, when bought)
        │                     ▼                     ▼
        │              ┌──────────┐               DONE
        └────────────▶ │ REJECTED │
              admin    └────┬─────┘
                            │  admin (reopen)
                            ▼
                          PENDING
```

Concretely:

- **Any → `done`** (any household member). Used when an item is bought.
- **`done` → `pending`** (any household member). Un-check.
- **`pending` → `in_review` | `approved` | `rejected`** (admin only).
- **`in_review` → `approved` | `rejected` | `pending`** (admin only).
- **`rejected` → `pending`** (admin only). Reopens a rejected item.
- Anything else: **400 Invalid status transition `<from>` -> `<to>`**.

Transitions to the same status (no-op) are accepted and return the row unchanged.

### Cross-list sync side effect on `done`

When `POST /items/{id}/status` flips an item to `done`, the same handler also deletes any matching `to_buy_list` row for that item (Direction A of the bidirectional sync — see [to-buy-flow.md](to-buy-flow.md)). Marking an item bought from either screen is the same buying event; the lists never drift.

No other status transition touches `to_buy_list`. If you need to remove an item from the to-buy list without marking the item bought (admin changed their mind), use `DELETE /to-buy/{entry_id}` — that one preserves `items.status`.

---

## Sequences

### Create

```
Member                    Backend                       Supabase
  | POST /items                                            |
  | Bearer <jwt>                                           |
  |--------------------------> current_user (verify JWT)   |
  |                            _user_household(caller)     |
  |                            INSERT items (..., status='pending', added_by=caller) -->|
  |<-- 201 ItemOut             SELECT to return row <-------|
```

### Status transition

```
Caller                    Backend                       Supabase
  | POST /items/{id}/status                                |
  | {status: "approved"}                                   |
  |--------------------------> _user_household -> (hh, role)
  |                            SELECT item where id and household_id   ─►|
  |                            (404 if not in caller's household)        |
  |                            _check_transition(from, to, role)         |
  |                              (400 invalid / 403 admin-only)          |
  |                            UPDATE items SET status -----►|
  |<-- 200 ItemOut             SELECT to return row <--------|
```

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 on POST/PATCH with bad enum value | Unknown `category`, `unit`, or `status` | Pydantic `Literal[...]` in [backend/app/items/schemas.py](../backend/app/items/schemas.py). |
| 422 on PATCH with empty body | `ItemUpdate` after-validator rejects no-op PATCH | [items/schemas.py](../backend/app/items/schemas.py) `ItemUpdate._at_least_one_field`. |
| 422 on `quantity <= 0` | `gt=0` constraint on the Decimal field | [items/schemas.py](../backend/app/items/schemas.py). |
| 403 "Caller is not in a household" | Authenticated user with no `household_id` row (shouldn't happen post-signup) | [items/router.py](../backend/app/items/router.py) `_user_household`. |
| 403 on status transition | Family attempted an admin-only transition (`in_review` / `approved` / `rejected` / `rejected→pending`) | [items/router.py](../backend/app/items/router.py) `_check_transition`. |
| 403 on PATCH | Non-admin, non-creator family member tried to edit someone else's item (FR-017) | [items/router.py](../backend/app/items/router.py) `update_item`. |
| 403 on DELETE | Non-admin, non-creator family member tried to delete (FR-018) | [items/router.py](../backend/app/items/router.py) `delete_item`. |
| **409 on PATCH** | Item is not in `status='pending'` — edit blocked for everyone, admin included (FR-017). Admin must `POST /items/{id}/status` back to `pending` first. | [items/router.py](../backend/app/items/router.py) `update_item`. |
| **409 on DELETE** | Item is not in `status='pending'` — delete blocked for everyone, admin included (FR-018). | [items/router.py](../backend/app/items/router.py) `delete_item`. |
| 404 on any read/write | Item not in caller's household (or doesn't exist) | [items/router.py](../backend/app/items/router.py) `_fetch_item_in_household`. |
| 400 invalid status transition | `<from> -> <to>` not in the allowed set (e.g. `done -> approved`) | [items/router.py](../backend/app/items/router.py) `_check_transition`. |

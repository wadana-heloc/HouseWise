# Items flow

Household shopping/inventory list. One row per item per household. Source of truth for fields, enums, and permissions is [supabase/migrations/0004_init_items.sql](../supabase/migrations/0004_init_items.sql) and [backend/app/items/router.py](../backend/app/items/router.py).

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
| PATCH | `/items/{id}` | any member | `ItemUpdate` (≥ 1 field) | Update any non-status field. |
| POST | `/items/{id}/status` | depends (see matrix) | `ItemStatusUpdate` | Transition `status`. Validated by the rules below. |
| DELETE | `/items/{id}` | creator or admin | — | Permanent delete. |

---

## Permissions

| Action | admin | family (creator) | family (non-creator) |
| --- | :---: | :---: | :---: |
| Create item | ✓ | ✓ | ✓ |
| List / get / patch any item in household | ✓ | ✓ | ✓ |
| Mark `done` | ✓ | ✓ | ✓ |
| Undo `done → pending` | ✓ | ✓ | ✓ |
| Set `in_review`, `approved`, `rejected` | ✓ | ✗ (403) | ✗ (403) |
| Reopen `rejected → pending` | ✓ | ✗ (403) | ✗ (403) |
| Delete | ✓ | ✓ | ✗ (403) |

Cross-household access is always **404** (not 403) so existence isn't leaked.

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
| 403 on DELETE | Non-admin, non-creator family member tried to delete | [items/router.py](../backend/app/items/router.py) `delete_item`. |
| 404 on any read/write | Item not in caller's household (or doesn't exist) | [items/router.py](../backend/app/items/router.py) `_fetch_item_in_household`. |
| 400 invalid status transition | `<from> -> <to>` not in the allowed set (e.g. `done -> approved`) | [items/router.py](../backend/app/items/router.py) `_check_transition`. |

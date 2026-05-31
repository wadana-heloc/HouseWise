# Stores flow

Per-household store list. The admin curates which shops the household compares prices at; any household member can read the list (the future AI price-report consumer will read it on the family side). Source of truth for the schema is [supabase/migrations/0007_init_stores.sql](../supabase/migrations/0007_init_stores.sql); endpoints in [backend/app/stores/router.py](../backend/app/stores/router.py).

Stores are independent of items and low-stock flags. There is no FK between them — store names are free text managed by the admin.

---

## Resource

`public.stores` — see [0007_init_stores.sql](../supabase/migrations/0007_init_stores.sql) for the canonical schema. Highlights:

- `household_id` — every store belongs to exactly one household. FK cascades on household delete.
- `name` — free text, 1–120 chars.
- `url` — normalized form, always includes scheme.
- `added_by` — `auth.users.id` of the admin who added it. `ON DELETE SET NULL`.
- **Unique** on `(household_id, lower(name))` — one store per name per household, case-insensitive.

---

## Endpoints

| Method | Path | Caller | Body | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/stores` | bearer:admin | `{name, url}` | Add a store. 409 if the name is already in this household. 422 on invalid URL. |
| GET | `/stores` | any member | — | List the caller's household stores, alphabetical. |
| PATCH | `/stores/{store_id}` | bearer:admin | `{name?, url?}` (≥ 1) | Edit name and/or URL. Same uniqueness + URL rules as POST. 404 cross-household. |
| DELETE | `/stores/{store_id}` | bearer:admin | — | Remove a store. 404 cross-household. |

Cross-household access is always **404** so existence isn't leaked.

---

## Permissions

| Action | admin | family |
| --- | :---: | :---: |
| Create store | ✓ | ✗ (403) |
| List stores | ✓ | ✓ |
| Patch store | ✓ | ✗ (403) |
| Delete store | ✓ | ✗ (403) |

Same role split as `/household/members/*`: admin manages, everyone reads.

---

## URL normalization

`POST /stores` and `PATCH /stores/{id}` both run the `url` field through `_normalize_url` in [backend/app/stores/schemas.py](../backend/app/stores/schemas.py):

1. Strip whitespace.
2. If the input doesn't begin with `http://` or `https://` (case-insensitive), prepend `https://`.
3. Validate via Pydantic's `HttpUrl`.
4. Require the host to contain at least one dot (rejects `localhost`, single-label names like `abc`).
5. Return the canonical string form (HttpUrl adds a trailing slash for bare hosts and lower-cases the host).

Example transformations:

| Input | Stored |
| --- | --- |
| `carrefour.ae` | `https://carrefour.ae/` |
| `  CARREFOUR.AE  ` | `https://carrefour.ae/` |
| `https://www.lulu.com` | `https://www.lulu.com/` |
| `http://local.example.com` | `http://local.example.com/` |

Rejected with **422** (clear message in the validation error):

- `""`, `"   "` — empty
- `"abc"` — single-label host, no dot
- `"javascript:alert(1)"` — non-http(s) scheme; once we prepend `https://`, the URL is malformed
- `"http://"` — missing host

---

## Uniqueness

Unique index `(household_id, lower(name))`:

- Admin POST with a name that already exists in this household (any casing) → **409**.
- Admin PATCH renaming to a colliding name → **409**.
- Two different households can each have their own "Carrefour".
- After DELETE, the freed name can be re-added.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 on POST/PATCH with bad URL | `_normalize_url` rejection (empty, single-label host, garbage scheme) | [backend/app/stores/schemas.py](../backend/app/stores/schemas.py) |
| 422 on POST with empty name | Pydantic `Field(min_length=1)` | [backend/app/stores/schemas.py](../backend/app/stores/schemas.py) |
| 422 on PATCH with empty body | `_at_least_one_field` model validator | [backend/app/stores/schemas.py](../backend/app/stores/schemas.py) `StoreUpdate` |
| 409 on POST/PATCH | Name already exists in this household — unique index hit | [backend/app/stores/router.py](../backend/app/stores/router.py) catches `duplicate`/`unique`/`23505` in the supabase-py exception and remaps |
| 403 on POST/PATCH/DELETE | Caller is not an admin (`require_role("admin")`) | [backend/app/stores/router.py](../backend/app/stores/router.py) |
| 403 on GET | Caller has no `household_id` (shouldn't happen post-signup) | [backend/app/stores/router.py](../backend/app/stores/router.py) `_caller_household_id` |
| 404 on PATCH/DELETE | Store doesn't exist or is in another household | [backend/app/stores/router.py](../backend/app/stores/router.py) `_fetch_store_in_household` |
| 422 on PATCH/DELETE with non-UUID id | FastAPI `UUID` path param validation | [backend/app/stores/router.py](../backend/app/stores/router.py) |
| Stored URL has a trailing slash even though I didn't type one | Pydantic `HttpUrl` always adds it for bare hosts | Expected behavior; mobile should compare URLs case-insensitively and treat trailing-slash differences as equivalent |

# Low-stock flow

Per-household "running low" flags. The home screen and the standalone "Flag an item" screen both read from this resource. Source of truth for the schema is [supabase/migrations/0006_init_low_stock.sql](../supabase/migrations/0006_init_low_stock.sql); endpoints in [backend/app/low_stock/router.py](../backend/app/low_stock/router.py).

Low-stock and the items shopping list ([docs/items-flow.md](items-flow.md)) are **two independent resources**. There is no FK between them; the mobile client can show an "on list" badge by name-matching its local items state against the low-stock list. The backend does no such matching.

---

## Resource

`public.low_stock_flags` — see [0006_init_low_stock.sql](../supabase/migrations/0006_init_low_stock.sql) for the canonical schema. Highlights:

- `household_id` — every flag belongs to exactly one household. FK cascades on household delete.
- `name` — free text, 1–120 chars.
- `added_by` — `auth.users.id` of the flagger. `ON DELETE SET NULL` so deleting a member doesn't cascade away their flags.
- **Unique** on `(household_id, lower(name))` — one flag per name per household, case-insensitive, regardless of flagger.

---

## Endpoints

| Method | Path | Caller | Body | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/low-stock` | any member | `{name}` | Add a flag. Server sets `household_id` and `added_by`. 409 if the name is already flagged in this household by anyone. |
| GET | `/low-stock` | any member | — | List the caller's household flags, newest first. Each row includes `added_by_display_name`. |
| DELETE | `/low-stock/{flag_id}` | any member | — | Clear a flag. Open to every household member by design — once the item is bought, anyone can remove the flag. |

Cross-household access is always **404** (not 403) so existence isn't leaked.

---

## Permissions

| Action | admin | family |
| --- | :---: | :---: |
| Create flag | ✓ | ✓ |
| List flags | ✓ | ✓ |
| Delete any flag in the household | ✓ | ✓ |

There is no admin-only path. All three endpoints accept any authenticated household member. This is intentional: the panel is a shared shopping signal, not an administrative resource.

---

## Uniqueness — one flag per name per household

The unique index is `(household_id, lower(name))`, **not** `(household_id, added_by, lower(name))`. The consequences:

- If Maha flags "Dish soap", Maha attempting to flag "Dish soap" again → **409**.
- If Maha flags "Dish soap", **Ahmad** attempting to flag "Dish soap" → **409** too.
- Casing doesn't matter: "Dish Soap" and "dish soap" are treated as the same name.
- Once the existing flag is deleted, the name is free — re-flagging succeeds.
- Per-household scope: two different households can each have their own "Toilet paper" flag.

If a future product decision wants per-user uniqueness instead (Maha and Ahmad can both have their own "Dish soap" rows), change the unique index to include `added_by` — no other code changes needed.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 on POST with empty/missing `name` | Pydantic `Field(min_length=1, max_length=120)` | [low_stock/schemas.py](../backend/app/low_stock/schemas.py) |
| 409 on POST | Name already flagged in this household (any member) — unique index hit | [low_stock/router.py](../backend/app/low_stock/router.py) `create_flag` matches the `supabase-py` error text for `duplicate`/`unique`/`23505` and remaps to 409 |
| 403 "Caller is not in a household" | Authenticated user with no `household_id` row (shouldn't happen post-signup) | [low_stock/router.py](../backend/app/low_stock/router.py) `_caller_household_id` |
| 404 on DELETE or path read | Flag not in caller's household, or doesn't exist | [low_stock/router.py](../backend/app/low_stock/router.py) `delete_flag` |
| 422 on DELETE with non-UUID id | FastAPI `UUID` path param validation | [low_stock/router.py](../backend/app/low_stock/router.py) |
| `added_by_display_name` is null in the response | The original flagger's account was deleted — `added_by` was nulled by `ON DELETE SET NULL`, and the join no longer resolves | Expected behavior; mobile should render "Flagged by someone" or just the timestamp |

# Profile flow

Self-update of `display_name`, `email`, per-user health preferences, and per-user dietary preferences; admin update of a family member's name/email. Source of truth for fields is [supabase/migrations/0001_init_auth.sql](../supabase/migrations/0001_init_auth.sql) (`public.users`) plus [supabase/migrations/0005_user_profile_and_health_prefs.sql](../supabase/migrations/0005_user_profile_and_health_prefs.sql) (`health_preferences jsonb`) and [supabase/migrations/0010_dietary_prefs_and_week_notes.sql](../supabase/migrations/0010_dietary_prefs_and_week_notes.sql) (`dietary_preferences jsonb`).

Password rotation is **not** here — that stays on [`POST /auth/password-update`](../backend/app/auth/router.py), documented in [auth-flow.md §6](auth-flow.md).

---

## Endpoints

| Method | Path | Caller | Body | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/me` | any member | — | Returns user (incl. `health_preferences` and `dietary_preferences`) + household snapshot. |
| PATCH | `/me/profile` | any member | `{display_name?, email?}` (≥ 1) | Self-update name and/or email. Email change is instant — no confirmation email. |
| PATCH | `/me/health-preferences` | any member | partial subset of the 5 toggles | Merges into existing JSONB; only sent keys change. Unknown keys → 422. |
| PATCH | `/me/dietary-preferences` | any member | partial subset of `{dietary_types?, allergies?, dislikes?}` (≥ 1) | Merges by top-level key; the FE sends the full replacement list for any key it wants to change. |
| PATCH | `/household/members/{id}` | bearer:admin | `{display_name?, email?}` (≥ 1) | Admin patches a member's name/email. 400 on self-target; admin uses `/me/profile` for themselves. 404 cross-household. |

Both health and dietary preferences are **strictly self-managed** — there is no admin endpoint to set them on another user. Dietary settings are personal data.

---

## Health-preference keys

The Pydantic schema in [backend/app/me/schemas.py](../backend/app/me/schemas.py) pins the known set:

| Key | UI label |
| --- | --- |
| `high_protein` | Prefer high protein |
| `low_calories` | Prefer low calories |
| `low_carbs` | Prefer low carbohydrates |
| `low_sugar` | Prefer low sugar |
| `whole_grain` | Prefer brown / whole grain |

`extra="forbid"` rejects any other key with 422. The JSONB column on `public.users` defaults to `'{}'` so missing rows still return a full-shape response with all keys `false`.

Adding a new toggle later: edit `HealthPreferences` + `HealthPreferencesUpdate` in [me/schemas.py](../backend/app/me/schemas.py). No migration needed.

---

## Dietary preferences

Three free-text list fields on `public.users.dietary_preferences` (JSONB):

| Key | Shape | UI source |
| --- | --- | --- |
| `dietary_types` | `list[str]` | Chip multi-select (Vegetarian / Vegan / Halal / Keto / Gluten-free / Dairy-free / Paleo / Nut-free) |
| `allergies` | `list[str]` | Free-text "add" input ("Peanuts", "Shellfish", ...) |
| `dislikes` | `list[str]` | Free-text "add" input ("Broccoli", "Mushrooms", ...) |

**`dietary_types` is NOT a backend enum** — Belal's call so the FE can add chips without a backend deploy. Trade-off: typos ("Vegetraian") will persist. The FE is the source of truth for the valid chip set; backend stores whatever it receives. If the chip set ever needs server-side validation, swap `list[str]` for `list[Literal[...]]` in [me/schemas.py](../backend/app/me/schemas.py).

**Merge semantics for PATCH `/me/dietary-preferences`** — top-level keys are merged; within a key the body fully replaces. Example:

```
state: { dietary_types: ["vegetarian"], allergies: ["peanuts"], dislikes: [] }
PATCH { allergies: ["shellfish"] }
state: { dietary_types: ["vegetarian"], allergies: ["shellfish"], dislikes: [] }
```

The migration's default ensures every existing user row has the full 3-key shape, so the GET response is always `{dietary_types: [...], allergies: [...], dislikes: [...]}` with empty lists for unset keys.

Meal-plan flow: the agent receives `household_members[i].dietary_preferences` automatically on every `POST /meal-plan/generate` — see [meal-plan-flow.md](meal-plan-flow.md#ai-agent-contract--what-the-backend-passes).

---

## Sequences

### Self profile update

```
User                    Backend                       Supabase
  | PATCH /me/profile                                    |
  | Bearer <jwt>                                         |
  | { email: "new@x.com", display_name?: "Z" }           |
  |--------------------------> current_user (verify JWT) |
  |                            if email set:             |
  |                              admin.update_user_by_id |
  |                              (target=caller,         |
  |                               email=new, email_confirm=True)
  |                              -- 409 on duplicate ---->|
  |                            UPDATE public.users       |
  |                              SET email, display_name |
  |                              WHERE id = caller       |
  |                            SELECT to return MeUser   |
  |<-- 200 MeUser              <-- row --------------------|
```

The new email is usable for `POST /auth/login` immediately. Existing access/refresh tokens for the caller remain valid until natural expiry — no forced logout.

### Self health-preferences update

```
User                    Backend                       Supabase
  | PATCH /me/health-preferences                         |
  | Bearer <jwt>                                         |
  | { high_protein: true, low_sugar: true }              |
  |--------------------------> current_user              |
  |                            SELECT current jsonb      |
  |                            merge with body           |
  |                            UPDATE public.users       |
  |                              SET health_preferences  |
  |                              WHERE id = caller       |
  |                            SELECT to confirm         |
  |<-- 200 HealthPreferences   <-- full 5-key shape -----|
```

The response always contains the full set of five keys, with `false` for anything the user hasn't touched.

### Admin patches a member

```
Admin                   Backend                       Supabase
  | PATCH /household/members/{member_id}                 |
  | Bearer <admin-jwt>                                   |
  | { email: "new@x.com" }                               |
  |--------------------------> require_role("admin")     |
  |                            _admin_household_id       |
  |                            reject 400 if             |
  |                              member_id == admin.id   |
  |                            SELECT member;            |
  |                              404 cross-household     |
  |                            admin.update_user_by_id   |
  |                              (target=member,         |
  |                               email_confirm=True)    |
  |                              -- 409 on duplicate ---->|
  |                            UPDATE public.users       |
  |                            SELECT to return MemberRow|
  |<-- 200 MemberRow           <-- row --------------------|
```

Like the password-reset endpoint, this does **not** invalidate the member's existing sessions. Their outstanding access tokens stay usable until natural expiry.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 on PATCH with empty body | The `_at_least_one_field` model validator catches it | [me/schemas.py](../backend/app/me/schemas.py), [household/schemas.py](../backend/app/household/schemas.py) |
| 422 on PATCH /me/health-preferences with unknown key (e.g. `fiber`) | `ConfigDict(extra="forbid")` | [me/schemas.py](../backend/app/me/schemas.py) `HealthPreferencesUpdate` |
| 409 on email update | Target email already registered in `auth.users` | The Supabase exception message is matched on `already`/`registered`/`exists` and mapped to 409 — same shape as the signup duplicate handler in [auth/router.py](../backend/app/auth/router.py) |
| Member's old email still works after admin patch | Cache stale — `auth.users` and `public.users` must both be updated. The endpoint does this explicitly; if you see drift, check both rows | [household/router.py](../backend/app/household/router.py) `update_member` |
| Mobile shows partial `health_preferences` (some keys missing) | Should never happen — handlers always return the full 5-key shape via `_merge_prefs` | [me/router.py](../backend/app/me/router.py) `_merge_prefs` |
| Admin gets 400 trying to patch themselves via `/household/members/{id}` | By design — admins must use `/me/profile` | [household/router.py](../backend/app/household/router.py) `update_member` |

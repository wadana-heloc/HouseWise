# HouseWise Backend

FastAPI + Supabase. Owns auth, households, and family-member membership.

## Stack

- **Python 3.11+** / **FastAPI**
- **Supabase** (Postgres + Auth) — JWKS / ES256 verification only, no HS256 shared secret
- `supabase-py` client with the `service_role` key (server-side only)

## Setup

```powershell
cd backend
# Use 64-bit Python — easyocr requires torch, which has no 32-bit Windows wheels.
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"          # installs runtime + dev (pytest, ruff, mypy)
copy .env.example .env           # then fill in values
uvicorn app.main:app --reload
```

Dependencies are declared in [pyproject.toml](pyproject.toml). The `[dev]` extra pulls test/lint/typecheck tools — drop it in production deploys (`pip install -e .`).

## Environment variables

See [.env.example](.env.example) for the full list. Required at startup:

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL, e.g. `https://abc.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key. **Never** ship to the mobile app. |
| `SUPABASE_ANON_KEY` | Used by the `/auth/login` and signup auto-login paths so the service_role client never has a user session attached. |
| `SUPABASE_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |
| `APP_DEEP_LINK` | `redirect_to` for the **admin** password-reset email. Only remaining email-link flow. Must be allow-listed in Supabase Dashboard → Auth → URL Configuration. |
| `ANTHROPIC_API_KEY` | Used by the image-analysis agent at [ai_agents/image-agent/](../ai_agents/image-agent/) for `POST /items/scan-image`. Required at startup. |

## Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST   | `/auth/signup` | public | Admin self-signup. Creates household + admin user with `email_confirm=True`, then auto-logs-in. Returns `{user_id, household_id, session}`. |
| POST   | `/auth/login`  | public | Email + password → Supabase session. No email-confirm gating. |
| POST   | `/auth/logout` | bearer | Sign out current device (`scope=local`). |
| POST   | `/auth/logout-all` | bearer | Sign out all devices (`scope=global`). |
| POST   | `/auth/password-reset` | public | **Admin-only.** Sends reset email if and only if the address belongs to a `role='admin'` user. Always 200 (no enumeration). Members forgot their password → admin uses `/household/members/{id}/password`. |
| POST   | `/auth/password-update` | bearer | Set new password for the bearer's account. Works for admins and members. |
| GET    | `/household/members` | bearer | List all members of the caller's household (admin first, then family by join order). Readable by any household member; writes below remain admin-only. |
| GET    | `/household/members/{id}` | bearer | Fetch one member by id. Any household member may read any other in the same household. 404 cross-household. |
| POST   | `/household/members` | bearer:admin | Create a family member with `{email, password, display_name}`. No invite email. Member can log in immediately. |
| POST   | `/household/members/{id}/password` | bearer:admin | Admin resets a member's password directly. Does not invalidate the member's existing sessions. |
| PATCH  | `/household/members/{id}` | bearer:admin | Admin updates a member's `display_name` and/or `email`. Email change is instant (no confirmation email). 400 on self-target (use `/me/profile`). |
| DELETE | `/household/members/{id}` | bearer:admin | Remove a family member. |
| GET    | `/me` | bearer | Current user (incl. `health_preferences`) + household snapshot. |
| PATCH  | `/me/profile` | bearer | Self-update `display_name` and/or `email`. Email change is instant (no confirmation email). |
| PATCH  | `/me/health-preferences` | bearer | Partial update of the per-user dietary toggles (high_protein, low_calories, low_carbs, low_sugar, whole_grain). Unknown keys → 422. |
| POST   | `/items` | bearer | Add an item to the caller's household. Server sets `status='pending'`, `added_by=caller`. |
| GET    | `/items` | bearer | List items in the caller's household. Filters: `status`, `urgent`, `category`, `added_by`. |
| GET    | `/items/{id}` | bearer | Fetch one item (404 cross-household). |
| PATCH  | `/items/{id}` | bearer | Update any non-status field. Empty body → 422. |
| POST   | `/items/{id}/status` | bearer | Transition `status`. Family may set `done` or undo `done→pending`; admin only for `in_review`/`approved`/`rejected` and reopening `rejected→pending`. |
| DELETE | `/items/{id}` | bearer | Delete. Creator or any admin in the household. |
| POST   | `/items/scan-image` | bearer | Run a product photo through the image-analysis agent. Pass-through — does not persist. Always 200; failures live in `reason`. |
| GET    | `/cookbook/recipes` | bearer | List recipes. Default scope: approved + caller's own pending. Filters: `tag`, `search`, `source`, `status`. |
| POST   | `/cookbook/recipes` | bearer | Manual entry → `source='manual'`, `status='approved'` (auto-approved). |
| GET    | `/cookbook/recipes/{id}` | bearer | Fetch one. 404 if pending and not own/admin, or cross-household. |
| PATCH  | `/cookbook/recipes/{id}` | bearer:admin | Edit any field including `status`. |
| DELETE | `/cookbook/recipes/{id}` | bearer:admin | Hard delete. |
| POST   | `/cookbook/recipes/{id}/approve` | bearer:admin | Flip a pending recipe to approved. Idempotent. |
| POST   | `/cookbook/recipes/generate` | bearer | AI generate via cookbook agent → `source='ai_generated'`, `status='pending'`. 502 on total agent failure. |
| POST   | `/cookbook/recipes/extract-photo` | bearer | AI photo extract → `source='photo'`, `status='pending'`. Partial extractions saved with reason annotated; 502 only on no-name failure. |
| POST   | `/low-stock` | bearer | Flag an item as running low. 409 if the name is already flagged in this household (any member). |
| GET    | `/low-stock` | bearer | List the caller's household flags, newest first. Each row includes `added_by_display_name`. |
| DELETE | `/low-stock/{flag_id}` | bearer | Clear a flag. Any household member may delete any flag. |
| POST   | `/stores` | bearer:admin | Add a store (`name`, `url`). URL normalized (bare hosts accepted). 409 if the name is already in this household. |
| GET    | `/stores` | bearer | List the caller's household stores, alphabetical. Any member can read. |
| PATCH  | `/stores/{store_id}` | bearer:admin | Update name and/or URL. Same uniqueness + URL rules as POST. |
| DELETE | `/stores/{store_id}` | bearer:admin | Remove a store. |
| GET    | `/health` | public | Liveness. |

Items flow + state machine + permission matrix: [docs/items-flow.md](../docs/items-flow.md).
Image-scan endpoint (pass-through to the AI agent): [docs/scan-image-flow.md](../docs/scan-image-flow.md).
Low-stock flags (per-household, name-unique): [docs/low-stock-flow.md](../docs/low-stock-flow.md).
Stores (admin-managed, family-readable): [docs/stores-flow.md](../docs/stores-flow.md).
Profile + health-preferences flow: [docs/profile-flow.md](../docs/profile-flow.md).
Cookbook (manual auto-approved; AI/photo pending → admin approve): [docs/cookbook-flow.md](../docs/cookbook-flow.md).

**Refresh** is intentionally **not** an endpoint here — the mobile client uses the Supabase JS SDK to refresh access tokens automatically. See [docs/auth-flow.md](../docs/auth-flow.md#token-refresh-handled-by-the-sdk).

### Input validation

- **Email**: every endpoint that accepts an email uses Pydantic's `EmailStr` (RFC-5322 syntax). Malformed addresses → 422.
- **Password policy** (enforced on signup, member create, member-password reset, and self password-update — **not** on `/auth/login`): ≥8 chars, must contain at least one lowercase letter, one uppercase letter, one digit, and one special character (`string.punctuation`). Violations → 422 with a message listing what's missing. Single source of truth: [app/auth/password_policy.py](app/auth/password_policy.py).

## Database

Run migrations in order in the Supabase SQL Editor:

1. [supabase/migrations/0001_init_auth.sql](../supabase/migrations/0001_init_auth.sql) — tables, GRANTs, starter RLS, triggers.
2. [supabase/migrations/0002_fix_rls_recursion.sql](../supabase/migrations/0002_fix_rls_recursion.sql) — replaces the self-referential `users` / `households` SELECT policies with a `SECURITY DEFINER` `current_household_id()` helper. Without it, any `SELECT` on `public.users` from an authenticated client throws `42P17 infinite recursion`.
3. [supabase/migrations/0003_reset_and_simplify_auth.sql](../supabase/migrations/0003_reset_and_simplify_auth.sql) — **DESTRUCTIVE.** Wipes `public.households`, `public.users`, and `auth.users` (in that order — `households.admin_id` is `ON DELETE RESTRICT`). Then hardens `users_update_self` with a `with check` clause so a logged-in member cannot self-mutate `role` or `household_id` via direct PostgREST.
4. [supabase/migrations/0004_init_items.sql](../supabase/migrations/0004_init_items.sql) — `public.items` table + `item_category` / `item_unit` / `item_status` enums + GRANTs + same-household SELECT RLS + `updated_at` trigger.
5. [supabase/migrations/0005_user_profile_and_health_prefs.sql](../supabase/migrations/0005_user_profile_and_health_prefs.sql) — adds `public.users.health_preferences jsonb not null default '{}'::jsonb`. Application-level schema in [backend/app/me/schemas.py](app/me/schemas.py) pins the known toggle keys.
6. [supabase/migrations/0006_init_low_stock.sql](../supabase/migrations/0006_init_low_stock.sql) — `public.low_stock_flags` + unique `(household_id, lower(name))` + GRANTs + same-household SELECT RLS + `updated_at` trigger.
7. [supabase/migrations/0007_init_stores.sql](../supabase/migrations/0007_init_stores.sql) — `public.stores` + unique `(household_id, lower(name))` + GRANTs + same-household SELECT RLS + `updated_at` trigger.
8. [supabase/migrations/0008_init_cookbook.sql](../supabase/migrations/0008_init_cookbook.sql) — `public.recipes` + `recipe_source` / `recipe_status` enums + GRANTs + RLS (approved-or-own-pending) + `updated_at` trigger.

0001 creates:
- `public.households`, `public.users` with FKs into `auth.users`
- `public.user_role` enum (`admin` | `family`)
- GRANTs for `service_role`, `authenticated`
- Starter RLS (read-own-household, update-own-profile only) — **superseded by 0002 for the SELECT policies**
- `updated_at` triggers
- `auth.users → public.users` seed trigger (stub row only; backend still does explicit `UPDATE` per spec §9.4)

## Tests

Integration tests hit a **real Supabase project**. No DB mocking — see [CLAUDE.md §5](../CLAUDE.md).

```powershell
cd backend
pip install -e ".[dev]"
# In .env, set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY /
# TEST_SUPABASE_JWKS_URL / TEST_SUPABASE_JWT_ISSUER.
pytest
```

If `TEST_SUPABASE_*` vars are unset, all integration tests **skip with a clear reason** (they do not silently pass).

Use a **dedicated test project** — tests create and delete users in `auth.users`. They clean up after themselves but accidents happen.

## Non-negotiables baked into this code (§9 of the spec)

1. JWKS / ES256 only — see [app/auth/deps.py](app/auth/deps.py).
2. Role read from `app_metadata`, never `user_metadata`.
3. GRANTs on every table even though `service_role` bypasses RLS.
4. Explicit `UPDATE public.users` after every `auth.admin.create_user`.
5. `SELECT` after `UPDATE` to confirm — the Python client's `.data` on UPDATE is unreliable.
6. `auth.admin.sign_out(jwt, scope=...)` — takes the **JWT**, not the user_id.
7. `service_role` never leaves the backend.
8. Token redaction in logs — see [app/logging_setup.py](app/logging_setup.py).

When adding new tables, repeat steps 3 + 4 for them.

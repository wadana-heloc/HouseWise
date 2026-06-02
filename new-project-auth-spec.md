# Auth Spec — New Project (v2)

Source of truth for HouseWise auth. v2 (2026-05-19) removes all email-link flows except admin password reset: no signup confirmation, no invite emails, no member self-recovery. Admin creates members directly with credentials; admin resets member passwords directly.

A task brief for Claude Code in a fresh repo. Covers signup, login, member creation, password management, sessions, and Supabase wiring.

---

## 1. Stack

- **Backend:** FastAPI (Python)
- **DB + Auth:** Supabase (new project — fresh `auth.users`, fresh `public` schema)
- **Frontend:** React Native (mobile) — tentative; spec assumes this but the backend contract is frontend-agnostic
- **Token transport:** Supabase JS SDK manages tokens on the client; client sends `Authorization: Bearer <access_token>` to FastAPI; FastAPI validates the JWT via Supabase's JWKS endpoint (ES256)

> ⚠️ **Do not** use the legacy HS256 shared `JWT_SECRET`. Use JWKS. (Burned us on MathQuest.)

---

## 2. Roles & data model

Two roles, stored on `public.users.role`:

| Role     | Who                                                    | Created by                                                              |
| -------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `admin`  | Household owner. Owns the household + all member data. | Self-signup via app. Immediate session — no email confirmation step.    |
| `family` | A member added under an admin's household.             | Admin POSTs `/household/members` with `{email, password, display_name}`. No invite email; member can log in immediately. |

**Constraints:**

- Every user belongs to **exactly one** household (`household_id NOT NULL` after signup / create completes).
- A household has **exactly one** admin (the creator) and **0..N** family members.
- `family` users **cannot self-signup**. The public signup endpoint creates a household + admin only.
- Admin shares member credentials out of band (verbal/SMS). Members can change their own password while logged in.

> **Open question (Q6 — defer):** what `family` members can actually *do* (read-only? CRUD on own profile? approve actions?). Drives RLS. Stub permissive read-own / write-own RLS for now; lock down per-feature in the feature PR that introduces the feature.

---

## 3. Database schema

### 3.1 `public.households`

```sql
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.households(admin_id);
```

### 3.2 `public.users` (app-side profile, mirrors `auth.users`)

```sql
create type public.user_role as enum ('admin', 'family');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  role public.user_role not null,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.users(household_id);
```

`household_id` is nullable only during the narrow window between `auth.admin.create_user` and the follow-up `UPDATE` in the signup transaction. After signup it is always set.

### 3.3 GRANTs

Even though the backend uses the `service_role` key, **explicit GRANTs are still required** on every table (RLS bypass ≠ schema permissions). For each new table:

```sql
grant usage on schema public to service_role, authenticated, anon;
grant select, insert, update, delete on public.households to service_role;
grant select, insert, update, delete on public.users      to service_role;
grant select on public.households to authenticated;
grant select on public.users      to authenticated;
```

### 3.4 RLS (starter policies)

Enable RLS on both tables. The 0001 SELECT policies referenced `public.users` from inside their own `USING` clause, which caused 42P17 infinite recursion. Migration **0002** routes the self-lookup through a `SECURITY DEFINER` helper `public.current_household_id()`. Migration **0003** hardens `users_update_self` so a logged-in member cannot self-mutate `role` or `household_id`.

Final state of the relevant policies (after 0003):

```sql
-- 0002
create or replace function public.current_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.users where id = auth.uid()
$$;

create policy households_select_own on public.households
  for select to authenticated
  using (id = public.current_household_id());

create policy users_select_same_household on public.users
  for select to authenticated
  using (household_id = public.current_household_id());

-- 0003
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.users where id = auth.uid())
    and household_id is not distinct from (select household_id from public.users where id = auth.uid())
  );
```

No `INSERT`/`DELETE` policies for `authenticated` — all writes that create/destroy users or households go through the backend with `service_role`.

---

## 4. Supabase project setup checklist

In the Supabase dashboard for the new project:

- [ ] **Auth → Providers → Email:** enable. "Confirm email" can be either on or off — the backend sets `email_confirm=True` on every `admin.create_user` call (admin signup and member create), so the dashboard setting is bypassed.
- [ ] **Auth → URL Configuration:** add the mobile app's deep link as a redirect URL (used only by admin password reset).
- [ ] **Auth → Email Templates:** **Reset password** is the only template that runs in production. Confirm signup and invite templates exist but are no longer invoked by the backend; leave them as defaults.
- [ ] **Auth → JWT:** confirm signing alg is **ES256** (asymmetric). Note the JWKS URL: `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
- [ ] **Project Settings → API:** copy the `anon` key (backend + mobile client) and `service_role` key (backend, server-side only — never ship to the client).
- [ ] Run migrations in order: 0001 → 0002 → 0003. (0003 is destructive — wipes existing rows.)

---

## 5. Environment variables

### Backend (`.env`)

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
SUPABASE_ANON_KEY=<anon_key>          # used by login + signup auto-login (fresh anon client)
SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
APP_DEEP_LINK=myapp://auth/callback   # redirect_to for admin password-reset email only
DATABASE_URL=postgresql://...         # if you use direct Postgres for migrations
```

### Mobile (`.env` — only public values)

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon_key>
```

---

## 6. Backend: JWT verification dependency

A FastAPI dependency that validates the bearer token against JWKS and returns the current user. Cache the JWKS (5–10 min); refresh on `kid` miss.

```python
# auth/deps.py
from fastapi import Depends, Header, HTTPException, status
from jose import jwt
import httpx, time

_JWKS_CACHE = {"keys": None, "fetched_at": 0}
_JWKS_TTL_SECONDS = 600

async def _get_jwks():
    now = time.time()
    if _JWKS_CACHE["keys"] is None or now - _JWKS_CACHE["fetched_at"] > _JWKS_TTL_SECONDS:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(settings.SUPABASE_JWKS_URL)
            r.raise_for_status()
            _JWKS_CACHE["keys"] = r.json()
            _JWKS_CACHE["fetched_at"] = now
    return _JWKS_CACHE["keys"]

async def current_user(authorization: str = Header(...)) -> CurrentUser:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    jwks = await _get_jwks()
    try:
        claims = jwt.decode(
            token, jwks,
            algorithms=["ES256"],
            audience=settings.SUPABASE_JWT_AUDIENCE,
            issuer=settings.SUPABASE_JWT_ISSUER,
        )
    except jwt.JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")

    # Role lives in raw_app_meta_data (NOT user_metadata — user_metadata is user-editable)
    role = claims.get("app_metadata", {}).get("role") or claims.get("role")
    return CurrentUser(
        id=claims["sub"],
        email=claims.get("email"),
        role=role,
        raw_claims=claims,
    )

def require_role(*allowed: str):
    async def _dep(u: CurrentUser = Depends(current_user)) -> CurrentUser:
        if u.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return u
    return _dep
```

> ⚠️ Read role from `raw_app_meta_data` / `app_metadata`. **Never** trust `user_metadata` — clients can write to it.

---

## 7. Endpoints

All paths under `/auth`. Public = no token required. Auth = bearer required.

**Input validation, applied to every endpoint below:**

- `email` fields are validated by Pydantic `EmailStr` (RFC-5322 syntax). Malformed addresses → 422.
- `password` / `new_password` fields must satisfy the policy: ≥8 characters, at least one lowercase letter, one uppercase letter, one digit, and one special character (`string.punctuation`). Violations → 422 with a message listing what's missing. **`/auth/login` is exempt** — login accepts whatever password the user already has so pre-policy accounts aren't locked out. Source: [backend/app/auth/password_policy.py](backend/app/auth/password_policy.py).

| Method | Path                                | Auth         | Purpose                                                                                                |
| ------ | ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/signup`                      | public       | Admin self-signup. Creates household + admin user with `email_confirm=true`. Auto-logs-in; returns session. |
| POST   | `/auth/login`                       | public       | Email + password → returns Supabase session. No email-confirm gating.                                  |
| POST   | `/auth/logout`                      | bearer       | Sign out current device (`scope=local`).                                                               |
| POST   | `/auth/logout-all`                  | bearer       | Sign out all devices for current user (`scope=global`).                                                |
| POST   | `/auth/password-reset`              | public       | **Admin-only.** Sends reset email only if email belongs to a `role='admin'` user. Always 200.          |
| POST   | `/auth/password-update`             | bearer       | Set new password for the bearer's account. Used by admins and members.                                 |
| GET    | `/household/members`                | bearer       | List all members in the caller's household (admin + family). Readable by any household member.         |
| GET    | `/household/members/{id}`           | bearer       | Fetch one member by id. Any household member may read any other in the same household. 404 cross-household. |
| POST   | `/household/members`                | bearer:admin | Create a family member with `{email, password, display_name}`. No invite email.                        |
| POST   | `/household/members/{id}/password`  | bearer:admin | Admin resets a member's password directly. Does NOT invalidate the member's existing sessions.         |
| PATCH  | `/household/members/{id}`           | bearer:admin | Admin updates a member's `display_name` / `email`. Email change uses `email_confirm=true` — no email sent. 400 on self-target. 404 cross-household. 409 on email conflict. |
| DELETE | `/household/members/{id}`           | bearer:admin | Remove a family member from the household.                                                             |
| GET    | `/me`                               | bearer       | Current user (incl. `health_preferences`) + household snapshot.                                        |
| PATCH  | `/me/profile`                       | bearer       | Self-update of `display_name` and/or `email`. Email change uses `email_confirm=true` — no email sent. 409 on conflict. |
| PATCH  | `/me/health-preferences`            | bearer       | Partial update of per-user health-preference toggles. Unknown keys → 422.                              |
| POST   | `/low-stock`                        | bearer       | Flag an item as running low in the caller's household. 409 if the name is already flagged (any member). |
| GET    | `/low-stock`                        | bearer       | List the caller's household low-stock flags, newest first. Includes flagger display name.              |
| DELETE | `/low-stock/{flag_id}`              | bearer       | Clear a flag. Open to any household member. 404 cross-household.                                       |
| POST   | `/stores`                           | bearer:admin | Add a store. URL normalized (bare hosts accepted). 409 on name conflict. 422 on invalid URL.           |
| GET    | `/stores`                           | bearer       | List the caller's household stores, alphabetical. Any household member may read.                       |
| PATCH  | `/stores/{store_id}`                | bearer:admin | Update `name` and/or `url`. Same uniqueness + URL rules as POST. 404 cross-household.                  |
| DELETE | `/stores/{store_id}`                | bearer:admin | Remove a store. 404 cross-household.                                                                   |
| POST   | `/items/scan-image`                 | bearer       | Pass-through to the image-analysis agent (EasyOCR + Claude). Returns `{name, brand, size, reason}` — does not persist. Always 200; failures live in `reason`. |
| GET    | `/cookbook/recipes`                 | bearer       | List recipes. Default scope: approved + caller's own pending. Filters: `tag`, `search`, `source`, `status`. |
| POST   | `/cookbook/recipes`                 | bearer       | Save (all three paths). Body `source` defaults to `manual`; FE sets `ai_generated`/`photo` after a preview. Status = admin → `approved`, family → `pending`. |
| GET    | `/cookbook/recipes/{id}`            | bearer       | Fetch one. 404 if pending and not own/admin, or cross-household.                                       |
| PATCH  | `/cookbook/recipes/{id}`            | bearer:admin | Edit any field including `status`. 404 cross-household.                                                |
| DELETE | `/cookbook/recipes/{id}`            | bearer:admin | Hard delete.                                                                                           |
| POST   | `/cookbook/recipes/{id}/approve`    | bearer:admin | Flip pending → approved. Idempotent (re-call on approved returns 200).                                 |
| POST   | `/cookbook/recipes/generate`        | bearer       | Pass-through preview (no DB write). Returns `RecipePreview`. 502 on total agent failure.               |
| POST   | `/cookbook/recipes/extract-photo`   | bearer       | Pass-through preview (no DB write). `RecipePreview.reason` populated on partial extraction.            |
| POST   | `/meal-plan/submissions`            | bearer       | Upsert caller's week submission. Re-submitting same week replaces.                                     |
| GET    | `/meal-plan/submissions/me`         | bearer       | Caller's own submission for `?week_start=...`. 404 if not yet submitted.                               |
| GET    | `/meal-plan/submissions/status`     | bearer       | Per-member `submitted: bool` list + counts. Booleans only; submission content not leaked.              |
| GET    | `/meal-plan/{week_start}`           | bearer       | Plan + 7 days. 404 if no plan yet for that week.                                                       |
| POST   | `/meal-plan/generate`               | bearer:admin | Generate / re-generate the weekly plan via AI. 502 on total agent failure (no row inserted).           |
| PATCH  | `/meal-plan/{plan_id}/days/{day_id}`| bearer:admin | Edit one day (`meal_name`, `prep_label`, `notes`, `recipe_id`).                                        |

Refresh is handled by the Supabase JS SDK on the client — there is no `/auth/refresh` endpoint on the backend.

### 7.1 `POST /auth/signup` — admin signup (auto-login)

Request:
```json
{ "household_name": "The Hamdehs",
  "display_name": "Belal",
  "email": "belal@example.com",
  "password": "..." }
```

Server logic:

1. Call `supabase.auth.admin.create_user({ email, password, email_confirm: true, app_metadata: { role: "admin" }, user_metadata: { display_name } })`. `email_confirm: true` makes the account immediately usable.
2. `INSERT INTO public.households (name, admin_id) VALUES (...)` → returns `household_id`. On failure, delete the just-created `auth.users` row.
3. **Explicit `UPDATE public.users`** to set `household_id`, `role='admin'`, `display_name`, `email`. Don't rely on the seed trigger alone.
4. **`SELECT` after `UPDATE`** to verify. The Python client's `.data` on UPDATE is unreliable.
5. Auto-login: `sign_in_with_password` **on a fresh anon client** (never the cached service_role client — attaching a user session to it breaks subsequent PostgREST calls).
6. Return `{ user_id, household_id, session: { access_token, refresh_token, expires_in, user } }`.

Errors: 409 if email exists, 422 on bad input. If steps 1–4 succeed but auto-login fails, return 500 with a descriptive message; don't delete the user (they exist; mobile can fall back to `/auth/login`).

### 7.2 `POST /auth/login`

Request: `{ email, password }`. Used by admins **and** members.

Server: call `sign_in_with_password` **on a fresh anon client** (never the shared service_role client). Return the full session:
```json
{ "access_token": "...", "refresh_token": "...", "expires_in": 3600, "user": { ... } }
```

Mobile stores tokens in **SecureStore** (iOS Keychain / Android Keystore), **never** plain AsyncStorage.

### 7.3 Token refresh — handled by the SDK

There is **no** `/auth/refresh` endpoint. The Supabase JS SDK refreshes automatically ~60s before access-token expiry. Defaults: access token ~1h, refresh token rotation enabled. Don't override.

### 7.4 `POST /auth/logout` — current device

Body: none. Reads bearer from header.

```python
@router.post("/logout")
async def logout(authorization: str = Header(...), _: CurrentUser = Depends(current_user)):
    token = authorization.split(" ", 1)[1]
    # IMPORTANT: admin.sign_out takes the JWT, NOT the user_id (MathQuest lesson)
    supabase.auth.admin.sign_out(token, scope="local")
    return {"ok": True}
```

### 7.5 `POST /auth/logout-all`

Same as above with `scope="global"` — revokes all refresh tokens for the user. Pass the JWT, not the user_id.

### 7.6 `POST /household/members` — admin creates a member (no email)

Request: `{ email, password, display_name }`.

Server logic:

1. `require_role("admin")` and fetch the caller's `household_id`.
2. Reject 409 if the household already contains a member with that email.
3. `admin.create_user({ email, password, email_confirm: true, app_metadata: { role: "family" }, user_metadata: { display_name } })`. The seed trigger inserts the stub `public.users` row with `role='family'` from `app_metadata`.
4. **Explicit `UPDATE public.users`** to set `household_id`, `role='family'`, `display_name`, `email`.
5. **`SELECT` after `UPDATE`** to verify.
6. Return `{ user_id, email, display_name, role: "family" }`.

No invite email is sent. The admin shares the credentials with the member out of band. The member can immediately log in via `/auth/login`.

### 7.7 `POST /auth/password-reset` (admin-only email)

- Always returns 200 (no enumeration).
- Looks up the email in `public.users`. Only if `role='admin'` does it call `supabase.auth.reset_password_email(email, options={"redirect_to": APP_DEEP_LINK})`.
- Members do not have an email-based recovery path. If a member forgets their password, the admin uses §7.8.

### 7.8 `POST /household/members/{member_id}/password` — admin resets a member

Request: `{ new_password }`.

Server logic:

1. `require_role("admin")` and fetch caller's `household_id`.
2. Reject 400 if `member_id == admin.id` (admins use `/auth/password-update` for themselves).
3. SELECT the target's `household_id`. Return 404 if not found OR not in the caller's household (the 404 avoids leaking existence).
4. `admin.update_user_by_id(member_id, { password: new_password })`.
5. Return `{ ok: true }`.

This does **not** invalidate the member's existing access tokens or refresh tokens. They remain valid until natural expiry. If that's a problem, delete + recreate the member.

### 7.9 `POST /auth/password-update` — bearer-authenticated self-update

Request: `{ new_password }`. Used by admins (after a recovery link or while logged in) and members (while logged in). Server calls `admin.update_user_by_id(user.id, { password })`.

---

## 8. Mobile (React Native) — auth contract

Even if I'm not writing the frontend, the contract the frontend must follow:

1. Use `@supabase/supabase-js` with a SecureStore-backed storage adapter (not the default AsyncStorage — refresh tokens in plaintext is a no).
2. On app start: `supabase.auth.getSession()` → if valid, attach `access_token` to every backend request via `Authorization: Bearer ...`.
3. Listen to `supabase.auth.onAuthStateChange` and re-attach tokens after refresh.
4. Deep link handler is needed **only for admin password recovery**. There is no email-confirm or invite-accept flow.
5. Logout: call `POST /auth/logout` first (revokes server-side), then `supabase.auth.signOut()` (clears local).

---

## 9. Hard-won patterns to bake in from day one

These are non-negotiable based on prior pain:

1. **JWKS / ES256 only.** Do not use the legacy HS256 shared secret. Verify against `.well-known/jwks.json`.
2. **Role from `raw_app_meta_data` / `app_metadata`**, never `user_metadata` (user-writable).
3. **GRANTs on every table**, even though `service_role` bypasses RLS. RLS bypass ≠ schema permission.
4. **Always `UPDATE public.users` explicitly** after `auth.admin.create_user`. Don't rely solely on a trigger to populate `role`/`household_id` — and if you do add a trigger, still verify by `SELECT`.
5. **`SELECT` after `UPDATE`** when using the Supabase Python client — the `.data` field on UPDATE responses is unreliable.
6. **`auth.admin.sign_out` takes the JWT, not the user_id.** Read the source if in doubt.
7. **Never log access tokens or refresh tokens.** Redact `Authorization` headers in request logs.
8. **`service_role` key never leaves the backend.** Not in mobile, not in repo, not in CI logs.

---

## 10. Test plan (minimum)

Integration tests against a real Supabase project (no mocking the DB):

- [ ] Admin signup → returns `{user_id, household_id, session}` with a usable access_token; `auth.users.email_confirmed_at` is set; `public.users.role='admin'`; `households.admin_id` matches.
- [ ] Login (admin) works immediately, no confirmation step.
- [ ] `/me` returns user + household for both admins and members.
- [ ] Family member self-signup is rejected (no public path exists).
- [ ] Admin creates member via `POST /household/members` → `public.users.role='family'`, `household_id` matches admin's, member can log in immediately.
- [ ] Family JWT contains `app_metadata.role='family'`.
- [ ] Family cannot create/delete/reset-password other members (403).
- [ ] Admin resets member's password via `POST /household/members/{id}/password` → old password fails, new password works.
- [ ] Admin in household A cannot reset a member in household B → 404.
- [ ] Member can change own password via `POST /auth/password-update`.
- [ ] `POST /auth/password-reset` for admin email returns 200 and emits a `recovery_requested` audit log entry.
- [ ] `POST /auth/password-reset` for family/unknown email returns 200 with **no** audit log entry.
- [ ] Member cannot self-promote to admin via direct PostgREST `UPDATE` (blocked by `users_update_self` `with check` from 0003).
- [ ] Old invite endpoints (`/household/members/invite`, `/household/members/{id}/resend-invite`) are gone (404).
- [ ] `/auth/logout` invalidates the current refresh token only.
- [ ] `/auth/logout-all` invalidates all refresh tokens for the user.
- [ ] JWT with tampered `role` claim fails signature verification.
- [ ] Admin deletes member → member cannot log in.

---

## 11. Open questions (resolve before locking RLS)

- **Q6 — family permissions:** what can a `family` user actually do beyond "read own household"? Until decided, RLS is "read own household, write own `display_name` only" — the 0003 `with check` blocks self-mutation of `role` and `household_id`. All other mutations go through the backend.
  - **Items resource (first concrete cut, 0004 + [docs/items-flow.md](docs/items-flow.md)):** family members can create/list/read/patch items, mark them `done`, undo `done→pending`, and delete items they themselves created. Only admins can set `in_review`/`approved`/`rejected` or reopen a rejected item; only the creator-or-admin can delete. Other resources still TBD on a per-feature basis.
  - **Household roster reads:** family members may `GET /household/members` and `GET /household/members/{id}` for anyone in their own household (drives the home-screen member chips). All writes on `/household/members/*` remain admin-only.
  - **Self profile + health preferences:** any household member can `PATCH /me/profile` (`display_name`, `email`) and `PATCH /me/health-preferences` (per-user dietary toggles, JSONB-backed). Health prefs are strictly self-managed — there is no admin endpoint to set them on another user. Admins additionally get `PATCH /household/members/{id}` to fix a member's name/email (mirrors the existing password-reset endpoint).
  - **Low-stock flags:** any household member can create/list/delete low-stock flags (`/low-stock/*`). One flag per name per household — re-flagging an already-flagged name (by anyone) → 409. Delete is open to every member, not just the creator, since the panel is a shared shopping signal.
  - **Stores:** admin-managed, family-readable. Admin creates/updates/deletes stores (`POST/PATCH/DELETE /stores`); any household member can `GET /stores`. One store per name per household (case-insensitive). URLs are normalized (`carrefour.ae` → `https://carrefour.ae/`).
  - **Cookbook recipes:** the two AI endpoints (`/recipes/generate`, `/recipes/extract-photo`) are **pass-through previews** — they return a `RecipePreview` shape without writing anything. The single save endpoint `POST /cookbook/recipes` accepts a `source` field (`manual` / `ai_generated` / `photo`) and persists one row. Status is set by caller role, not by `source`: admin → `approved`, family → `pending`. Family submissions require an admin `POST /cookbook/recipes/{id}/approve` before family-wide visibility. The submitter sees their own pending row; other family members do not.
  - **Meal plan:** any household member can submit their week (busy days + meal requests) and read the resulting plan; only admin can call `POST /meal-plan/generate` or edit a day. The agent's output replaces any existing draft for that week (delete-then-insert of the 7 day rows). Total agent failure → **502, no row inserted** (same write-vs-pass-through split as cookbook). Finalize / shopping-list auto-pop / prices / reactions are **deferred** — their UIs don't exist yet.
- Do you want admins to be able to **transfer ownership** of a household? (Out of scope for v1 unless you say otherwise.)
- Do you want **soft-delete** of family members (keep history) or hard-delete? Spec assumes hard-delete via `on delete cascade`.
- Followup: today `_admin_household_id` reads role from `public.users`, not the JWT. Combined with the 0003 `with check`, the privilege escalation is closed. Worth refactoring role checks to read exclusively from the signed JWT.

---

## 12. What to hand Claude Code in the new repo

A single prompt along the lines of:

> Implement the auth layer described in `new-project-auth-spec.md`. Stack: FastAPI + Supabase (new project) + React Native client. Start with §3 migrations, §6 JWT dependency, then §7 endpoints in the order listed. Use JWKS/ES256 only. Follow every item in §9 — they are not optional. Write the §10 tests against a real Supabase project (no DB mocking).

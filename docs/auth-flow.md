# Auth flow

End-to-end auth contract for HouseWise. Source of truth is [new-project-auth-spec.md](../new-project-auth-spec.md); this doc shows the runtime sequences after the v2 redesign.

What changed in v2: no email confirmation on signup, no invite emails, no member-driven password recovery. Admin password reset is the only surviving email-link flow.

---

## Actors

- **Mobile** — React Native app, uses `@supabase/supabase-js`. Holds tokens in SecureStore (iOS Keychain / Android Keystore).
- **Backend** — FastAPI ([backend/](../backend/)). Uses the `service_role` key for admin actions; uses the `anon` key on a fresh client for `sign_in_with_password` calls (login + signup auto-login).
- **Supabase** — Postgres + GoTrue auth. Issues tokens, owns `auth.users`. Sends an email only for admin password reset.

---

## 1. Admin signup (creates a new household + auto-login)

```
Mobile                  Backend (FastAPI)             Supabase
  |                          |                          |
  |  POST /auth/signup       |                          |
  |  {household_name,        |                          |
  |   display_name,          |                          |
  |   email, password}       |                          |
  |------------------------->|                          |
  |                          | admin.create_user        |
  |                          |   email_confirm=true     |
  |                          |   app_metadata.role=admin|
  |                          |------------------------->|
  |                          |<--- user_id -------------|
  |                          | INSERT households        |
  |                          |------------------------->|
  |                          | UPDATE public.users      |
  |                          |  set household_id, role  |
  |                          |------------------------->|
  |                          | SELECT to confirm        |
  |                          |------------------------->|
  |                          | sign_in_with_password    |
  |                          |  (anon client, fresh)    |
  |                          |------------------------->|
  |                          |<-- session --------------|
  |<-- 201                   |                          |
  |  {user_id, household_id, |                          |
  |   session: {             |                          |
  |     access_token,        |                          |
  |     refresh_token,       |                          |
  |     expires_in, user}}   |                          |
```

No confirmation email is sent. Admin can call `/me` and the rest of the API immediately.

---

## 2. Login

```
Mobile                  Backend                        Supabase
  | POST /auth/login (email, password) -------------->|
  |                          |  sign_in_with_password->|
  |                          |  (anon client, fresh)   |
  |                          |<--- session ------------|
  |<-- 200                   |                          |
  |  {access_token,          |                          |
  |   refresh_token,         |                          |
  |   expires_in, user}      |                          |
```

Same endpoint for admins and members. No email-confirmation gating (it's set at create time).

The login client must be a **fresh anon client** ([backend/app/supabase_client.py](../backend/app/supabase_client.py) `get_anon_supabase`). Reusing the cached service_role client attaches the user's session to it and silently breaks subsequent PostgREST calls.

---

## 3. Authenticated request → JWT verification

```
Mobile                                   Backend
  | GET /me                                |
  | Authorization: Bearer <access_token>   |
  |--------------------------------------->|
  |                                        | JWKS cache hit?
  |                                        |   yes -> verify ES256
  |                                        |   no  -> fetch jwks.json (5–10 min TTL)
  |                                        | Decode claims; reject HS256
  |                                        | role = claims.app_metadata.role
  |                                        |   (NEVER user_metadata)
  |                                        | (per-route role check via require_role)
  |<-- 200 { user, household }-------------|
```

JWKS cache: 10 min TTL ([backend/app/auth/deps.py:21](../backend/app/auth/deps.py#L21)). On signature failure we force-refresh once to handle key rotation, then fail.

---

## 4. Token refresh — **handled by the SDK**

There is no `/auth/refresh` endpoint. Refresh is the Supabase JS SDK's job. Unchanged from v1.

### How the SDK does it

1. On app start, mobile constructs a Supabase client with a SecureStore-backed storage adapter:
   ```ts
   import { createClient } from "@supabase/supabase-js";
   import * as SecureStore from "expo-secure-store";

   const SecureStoreAdapter = {
     getItem: (k: string) => SecureStore.getItemAsync(k),
     setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
     removeItem: (k: string) => SecureStore.deleteItemAsync(k),
   };

   export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
     auth: {
       storage: SecureStoreAdapter,
       autoRefreshToken: true,
       persistSession: true,
       detectSessionInUrl: false,
     },
   });
   ```
2. SDK schedules a refresh timer ~60 seconds before `access_token` expires (default token lifetime is 1 hour; do not override).
3. When the timer fires, SDK POSTs to `https://<project-ref>.supabase.co/auth/v1/token?grant_type=refresh_token`. Refresh tokens **rotate** — old one invalidated.
4. SDK updates SecureStore atomically and emits `TOKEN_REFRESHED` via `supabase.auth.onAuthStateChange`.
5. Mobile must subscribe and update its in-memory access token:
   ```ts
   supabase.auth.onAuthStateChange((event, session) => {
     if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
       currentAccessToken = session?.access_token ?? null;
     }
     if (event === "SIGNED_OUT") {
       currentAccessToken = null;
     }
   });
   ```
6. When the app comes back from background, call `supabase.auth.getSession()` once.

### Edge cases

- **Refresh token is dead** (revoked or rotated-and-lost): SDK fires `SIGNED_OUT`. Mobile routes to login.
- **Large clock skew**: surfaces as 401s right after refresh.
- **Offline at refresh time**: SDK retries on foreground/network event.

---

## 5. Family member create (admin-driven, no email)

```
Mobile (admin)            Backend                       Supabase
  | POST /household/members                                |
  | { email, password, display_name }                      |
  |-------------------------->|                            |
  |                           | require_role("admin")     |
  |                           | _admin_household_id        |
  |                           | reject 409 if email        |
  |                           |   already in household     |
  |                           | admin.create_user          |
  |                           |   email_confirm=true       |
  |                           |   app_metadata.role=family |
  |                           |   password=...             |
  |                           |--------------------------->|
  |                           |<-- new user_id ------------|
  |                           | UPDATE public.users        |
  |                           |   household_id, role,      |
  |                           |   display_name, email      |
  |                           | SELECT to confirm          |
  |<-- 201 {user_id, email,   |                            |
  |   display_name,           |                            |
  |   role: "family"}         |                            |
```

No invite email. Admin shares the credentials with the family member out of band (verbally, SMS, etc.). The member can log in immediately using `/auth/login`.

---

## 6. Member self-password-update

```
Mobile (member)           Backend                       Supabase
  | POST /auth/password-update                              |
  | Authorization: Bearer <member access_token>             |
  | { new_password }                                        |
  |-------------------------->|                              |
  |                           | current_user (verifies JWT) |
  |                           | admin.update_user_by_id     |
  |                           |   { password }              |
  |                           |---------------------------->|
  |<-- 200 {ok: true}         |                              |
```

Same endpoint and same code path the admin uses to rotate their own password. The bearer token decides whose password gets updated.

---

## 7. Admin resets a member's password (no email)

```
Mobile (admin)            Backend                       Supabase
  | POST /household/members/{member_id}/password            |
  | Authorization: Bearer <admin access_token>              |
  | { new_password }                                        |
  |-------------------------->|                              |
  |                           | require_role("admin")       |
  |                           | _admin_household_id          |
  |                           | SELECT member's              |
  |                           |   household_id; 404 if not   |
  |                           |   in same household          |
  |                           | reject 400 if member_id      |
  |                           |   == admin.id                |
  |                           | admin.update_user_by_id      |
  |                           |   { password }               |
  |                           |---------------------------->|
  |<-- 200 {ok: true}          |                              |
```

**Does not** invalidate the member's existing access or refresh tokens. They remain valid until natural expiry. If you need that, the member must log out (or admin must delete + recreate the member, which is heavier-handed).

---

## 8. Admin password reset (email — the only remaining email-link flow)

```
Mobile (admin)            Backend                       Supabase
  | POST /auth/password-reset { email } --------------->|
  |                           | SELECT role from         |
  |                           |   public.users           |
  |                           |   where email = ?        |
  |                           | if role != 'admin':      |
  |                           |   skip (200 anyway)      |
  |                           | else:                    |
  |                           |   reset_password_email  ->|
  |                           |   with redirect_to=      |
  |                           |   APP_DEEP_LINK          |
  |<-- 200 (always)           |                          |
  |
  | Admin clicks link in email
  | -> deep link opens mobile app
  | -> Supabase issues a recovery session
  | -> mobile picks up session via supabase.auth.getSession()
  | -> mobile prompts for new password
  | -> mobile calls POST /auth/password-update with bearer = recovery access_token
```

Member emails entered here yield 200 with no email sent. Members who forgot their password go through their household admin, who uses §7 to reset it.

---

## 9. Logout

- `POST /auth/logout` → `admin.sign_out(jwt, scope="local")`. Revokes the **refresh token tied to this access token**. Other devices' sessions survive.
- `POST /auth/logout-all` → `admin.sign_out(jwt, scope="global")`. Revokes **all** refresh tokens for this user.

Mobile must call `supabase.auth.signOut()` after the backend call to clear local SecureStore. Order matters — server first, then local.

Note: JWTs are stateless. Outstanding access tokens remain valid until their natural `exp` (≤ 1h). Logout only kills refresh.

---

## 10. Common failure modes & how the code handles them

| Symptom | Root cause | Where |
| --- | --- | --- |
| Backend can't see new user in `public.users` | Trigger ran but explicit `UPDATE` missing | Never — every create path does `UPDATE` then `SELECT` to confirm. |
| `permission denied for table public.X` from `service_role` | Missing `GRANT` | Add `grant ... to service_role` in the migration. RLS bypass ≠ schema permission. |
| Role check skipped because role read from `user_metadata` | Wrong claim source | [auth/deps.py](../backend/app/auth/deps.py) reads only `app_metadata`. |
| `admin.sign_out` returns 4xx | Passed `user_id` instead of JWT | Always pass the bearer token. See `/auth/logout` impl. |
| Tokens appearing in logs | Missing redaction | [app/logging_setup.py](../backend/app/logging_setup.py) installs `TokenRedactingFilter` globally. |
| `infinite recursion detected in policy for relation "users"` (42P17) on any `/me`-style call | RLS policy on `public.users` self-references `public.users` | Fixed in [0002_fix_rls_recursion.sql](../supabase/migrations/0002_fix_rls_recursion.sql) by routing the self-lookup through a `SECURITY DEFINER` helper. |
| Backend PostgREST calls hit RLS as the logged-in user instead of `service_role` | `sign_in_with_password` was called on the shared service_role client, attaching a session to it | Login + signup auto-login both use a fresh anon client ([supabase_client.py](../backend/app/supabase_client.py) `get_anon_supabase`). |
| Member calls Supabase REST directly and tries `UPDATE public.users SET role='admin'` | Policy `with check` from 0003 blocks role/household_id self-mutation | [0003_reset_and_simplify_auth.sql](../supabase/migrations/0003_reset_and_simplify_auth.sql). PostgREST returns 4xx. |
| A family member POSTs `/auth/password-reset` and never gets an email | By design — only admin emails trigger reset. Member forgot pw → admin resets via `/household/members/{id}/password`. | [auth/router.py](../backend/app/auth/router.py) `password_reset`. |

# AGENTS.md — onboarding for coding agents (and new engineers)

If you're an LLM agent or a new engineer picking up this repo, read this first. Then read [CLAUDE.md](CLAUDE.md) for collaboration preferences and [new-project-auth-spec.md](new-project-auth-spec.md) for the auth design.

---

## What this repo is

**HouseWise** — a household-management app. One admin per household, 0..N family members.

- **Mobile:** React Native (Expo). Owned by a separate engineer. Lives in [app/](app/), [assets/](assets/), [package.json](package.json).
- **Backend:** FastAPI + Supabase. Lives in [backend/](backend/) and [supabase/](supabase/).
- **Docs:** [docs/](docs/) — keep these in sync with the code in the same commit.

The repo owner (Belal) **owns backend only**. Do not edit the mobile app unless explicitly asked. If a backend change requires a frontend contract change, describe the contract (request/response shape, headers, error codes) and let the mobile engineer implement.

---

## Stack at a glance

| Concern | Tool | Where |
| --- | --- | --- |
| HTTP API | FastAPI | [backend/app/main.py](backend/app/main.py) |
| Auth verification | python-jose, JWKS / **ES256 only** | [backend/app/auth/deps.py](backend/app/auth/deps.py) |
| Supabase access | `supabase-py` with `service_role` key | [backend/app/supabase_client.py](backend/app/supabase_client.py) |
| Config | pydantic-settings, `.env` | [backend/app/settings.py](backend/app/settings.py) |
| DB schema | Raw SQL, copy-pasted into Supabase SQL Editor | [supabase/migrations/](supabase/migrations/) |
| Tests | pytest, real Supabase project | [backend/tests/](backend/tests/) |
| Logging | stdlib + `TokenRedactingFilter` | [backend/app/logging_setup.py](backend/app/logging_setup.py) |

Python 3.11+. PowerShell on the dev machine.

---

## Map of the backend

```
backend/
  app/
    main.py            # FastAPI app + router wiring
    settings.py        # Settings(BaseSettings) — env loading
    supabase_client.py # singleton service-role client
    logging_setup.py   # token-redacting log filter
    auth/
      deps.py          # current_user, require_role, bearer_token
      router.py        # /auth/* endpoints
      schemas.py
    household/
      router.py        # /household/members/* endpoints
      schemas.py
    items/
      router.py        # /items/* — per-household shopping/inventory list
      schemas.py
    low_stock/
      router.py        # /low-stock/* — per-household "running low" flags
      schemas.py
    me/
      router.py        # GET /me, PATCH /me/profile, PATCH /me/health-preferences
      schemas.py       # MeUser/MeHousehold/MeResponse, HealthPreferences*, ProfileUpdate
    stores/
      router.py        # /stores/* — admin-managed, family-readable store list
      schemas.py       # StoreCreate/Update/Out + _normalize_url
  tests/
    conftest.py        # skip-if-unconfigured, real-Supabase fixtures
    test_auth.py       # §10 test plan
    test_items.py      # items CRUD + status transitions + permissions
    test_low_stock.py  # low-stock flag CRUD + uniqueness
    test_me.py         # self profile updates + health preferences
    test_stores.py     # stores CRUD + URL normalization + uniqueness
  requirements.txt
  .env.example         # template
  .env                 # local-only, gitignored
  pytest.ini
  README.md

supabase/
  migrations/
    0001_init_auth.sql                       # paste into Supabase SQL Editor
    0002_fix_rls_recursion.sql               # SECURITY DEFINER current_household_id()
    0003_reset_and_simplify_auth.sql         # DESTRUCTIVE — hardens users_update_self
    0004_init_items.sql                      # items table + enums + RLS
    0005_user_profile_and_health_prefs.sql   # adds users.health_preferences jsonb
    0006_init_low_stock.sql                  # low_stock_flags table + unique (household, lower(name))
    0007_init_stores.sql                     # stores table + unique (household, lower(name)) + RLS

docs/
  auth-flow.md         # runtime sequences, SDK refresh, failure modes
  items-flow.md        # items endpoints, permission matrix, status state machine
  low-stock-flow.md    # low-stock flags, uniqueness, open-delete rule
  profile-flow.md      # self profile + health-preferences + admin member-patch
  stores-flow.md       # stores CRUD, URL normalization, admin/family permission split
```

---

## Running it

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # then edit .env with real Supabase values
uvicorn app.main:app --reload
```

DB setup: open the Supabase SQL Editor for your project and run [supabase/migrations/0001_init_auth.sql](supabase/migrations/0001_init_auth.sql) once.

Tests:

```powershell
cd backend
pytest
```

Tests **skip with a clear message** if `TEST_SUPABASE_*` env vars are unset. They **never** mock the database. Use a dedicated test Supabase project — tests create and delete users in `auth.users`.

---

## The eight rules you cannot break

These come from prior incidents (see [CLAUDE.md §7](CLAUDE.md) and [spec §9](new-project-auth-spec.md)). If you violate one, the bug is subtle and may not surface until production.

1. **JWKS / ES256 only.** No HS256 shared secret. Verify against `.well-known/jwks.json`.
2. **Role from `app_metadata`, never `user_metadata`.** User metadata is client-writable — trusting it is a privilege escalation bug.
3. **GRANTs on every table.** Even though `service_role` bypasses RLS, schema-level `GRANT` is still required. Forgetting this produces `permission denied` errors that look like RLS bugs.
4. **Always `UPDATE public.users` explicitly** after `auth.admin.create_user`. The seed trigger only writes a stub — your code must set `household_id`, `role`, `display_name`.
5. **`SELECT` after `UPDATE`** when using `supabase-py`. The `.data` field returned on UPDATE is unreliable.
6. **`auth.admin.sign_out(jwt, scope=...)` takes the JWT, not the user_id.**
7. **`service_role` key never leaves the backend.** Not in mobile, not in committed config, not in CI logs.
8. **Never log tokens.** `TokenRedactingFilter` is installed globally — don't bypass it with `print()` or by formatting tokens into log messages yourself.

If you find existing code that violates one of these, **flag it; do not silently work around it.**

---

## Items: status & permissions (don't silently relax)

The `/items` resource enforces an admin-gated approval workflow. If you touch [backend/app/items/router.py](backend/app/items/router.py), preserve these invariants — they are deliberate, not legacy:

- **Status transitions** (full diagram in [docs/items-flow.md](docs/items-flow.md)): any member can set `done` or undo `done → pending`; **only admins** can set `in_review`, `approved`, `rejected`, or reopen `rejected → pending`. Same-status (no-op) writes are accepted. Everything else is **400**.
- **Delete** is restricted to the creator (`added_by == caller.id`) or any admin in the household. Non-creator family members get **403**.
- **Cross-household access is 404, never 403** — existence must not leak.

If a feature request seems to ask for "let family approve their own items" or "anyone can delete anything", surface the gap and confirm — don't silently widen.

---

## Communication and code preferences

See [CLAUDE.md](CLAUDE.md) for the long version. Highlights:

- **Terse.** No filler. Don't summarize what you just did at the end of every response.
- **No defensive code for impossible cases.** Trust internal callers and framework guarantees. Validate at system boundaries only (HTTP input, external API responses).
- **No backwards-compat shims for code with no production traffic.** Just change it.
- **Comments default to none.** Only when the *why* is non-obvious (a hidden constraint, a workaround for a specific bug). Never explain *what* the code does — names should do that.
- **Update docs in the same commit as the code change.** Don't leave doc updates "for later." Later doesn't happen.
- **Ask before destructive or shared-state actions** (push, force-push, dropping tables, deleting branches, sending to Slack/email, modifying CI). One approval ≠ open-ended authorization.
- **Don't bypass safety as a shortcut.** No `--no-verify`. No deleting lockfiles. No `git checkout .` to make unfamiliar changes go away.

---

## Production-only environment

There is no staging Supabase project. Migrations land in prod after local testing. **Be deliberate.** When in doubt, ask — two sentences of clarification beat an hour of rework.

---

## When adding a new feature

1. Add migration SQL in [supabase/migrations/](supabase/migrations/) (timestamped: `0002_*.sql`, `0003_*.sql`, ...). Include `GRANT`s. Include RLS (start permissive read-own, write-own; tighten in the feature PR).
2. Add a router under [backend/app/](backend/app/) — one module per resource. Mirror the pattern in `household/router.py`.
3. Add Pydantic schemas next to the router.
4. Add integration tests in [backend/tests/](backend/tests/). Real Supabase. Track created `auth.users` IDs in the `created_users` fixture so they get cleaned up.
5. Update [backend/README.md](backend/README.md) endpoints table.
6. If the feature has a runtime flow worth diagramming, add `docs/<feature>-flow.md`.

---

## Open questions tracked in the spec

[new-project-auth-spec.md §11](new-project-auth-spec.md) lists known unresolved questions (Q6 family permissions, household ownership transfer, soft- vs hard-delete). RLS is intentionally permissive until these resolve — tighten per-feature when you add the relevant feature PR.

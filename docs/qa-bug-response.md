# QA bug-report follow-up — backend

**To:** QA Engineer
**From:** Belal (backend)
**Date:** 2026-06-17
**Scope:** all 13 bugs from your latest report (BUG-001..BUG-013)

Triage and status below. Sections in order of what I need from you:

1. **Fixed — please re-test** (4 bugs)
2. **Need your input** — wording / spec questions blocking the fix (3 bugs)
3. **Blocked — need diagnostic data from you** (1 bug)
4. **Working as intended / spec mismatch — push back if you disagree** (4 bugs)
5. **Deferred from v1** (1 bug)

---

## 1. Fixed — please re-test

### BUG-001 — Deeply nested JSON crashes 500 → now returns 422

Inbound JSON bodies nested deeper than **32 levels** are rejected with `422 {"detail":"JSON nesting exceeds maximum depth of 32"}` before they reach Pydantic. The scan is non-recursive, so it can't trip the recursion error it protects against.

**Re-test:**
```bash
# Depth bomb → 422 with depth message
BOMB=$(python -c "print('{'*50 + '\"x\":1' + '}'*50)")
curl -sS -X POST $BASE/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BOMB" -w '\n%{http_code}\n'

# Normal payload still works → 201
curl -sS -X POST $BASE/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Milk","category":"dairy","quantity":1,"unit":"L"}' \
  -w '\n%{http_code}\n'
```

Expect `422` on the bomb, `201` on the normal POST.

---

### BUG-002 — Member ops on non-existent id returned 500 → now return 404

Both `DELETE /household/members/{id}` and `POST /household/members/{id}/password` returned 500 when the id didn't exist (PostgREST `.single()` raising on zero rows). Fixed — they now return 404 with `{"detail":"Member not in your household"}`.

**Re-test (any valid admin token):**
```bash
GHOST="00000000-0000-0000-0000-000000000000"

# DELETE nonexistent member → 404
curl -sS -X DELETE $BASE/household/members/$GHOST \
  -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}\n'

# POST password reset on nonexistent member → 404
curl -sS -X POST $BASE/household/members/$GHOST/password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"new_password":"Zz9!aaaaaaaa"}' -w '\n%{http_code}\n'
```

Both should print `404`. Pre-fix both were `500`.

---

### BUG-008 — Login error leaked enumeration signal → now returns constant body

`POST /auth/login` previously returned `401 {"detail":"Invalid credentials: <Supabase exception text>"}` — and the `<exception text>` differed between "user not found", "wrong password", and TLD-validation failures, giving an attacker a way to distinguish them.

Fixed — every bad-credential path now returns `401 {"detail":"Invalid credentials"}` (exact body, no trailing reason). The diagnostic detail is logged server-side under the `housewise.auth` logger so we don't lose visibility into real auth blowups.

**Re-test:**
```bash
# Unknown email → 401 with constant body
curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nope@nope.test","password":"anything-Aa1!"}' -w '\n%{http_code}\n'

# Known email, wrong password → identical body
curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_REAL_ADMIN_EMAIL","password":"wrong-Aa1!"}' -w '\n%{http_code}\n'
```

Both must print `{"detail":"Invalid credentials"}` followed by `401` — **identical** response bodies. If any of your existing tests asserted on substring matching ("Invalid credentials: invalid login"), they'll need updating.

---

### BUG-009 — Unknown request fields silently ignored → now return 422

Previously: an FE typo like `{"qty": 1}` instead of `{"quantity": 1}` was a silent no-op — the request returned 201 with `quantity` defaulted to 1.0, the typo'd key dropped without warning.

Fixed — every top-level request body now has `extra="forbid"`. Unknown keys produce:
```
422 {"detail":[{"type":"extra_forbidden","loc":["body","<key>"], "msg":"Extra inputs are not permitted", ...}]}
```

**Re-test:**
```bash
# Send a non-existent key on POST /items → 422 naming the offending key
curl -sS -X POST $BASE/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Milk","category":"dairy","quantity":1,"unit":"L","ghost":true}' \
  -w '\n%{http_code}\n'
```

Expect `422` and `"ghost"` mentioned in the response body. **Heads-up:** any of your existing tests that posted extra/dead fields and expected `2xx` will now fail. The new behavior is the intended fix — flag if you find broken tests so I can confirm they were relying on the silent-drop behavior.

---

## 2. Need your input — wording / spec questions

### BUG-004 + BUG-005 — Empty/whitespace names + untrimmed storage (FR-024)

Trimming on input fixes the empty-name acceptance and lets FE-side dedup work. But **FR-024 dedup scope** changes the design:

- **(a)** Does FR-024 just want backend to store names trimmed (e.g. `"Milk "` → `"Milk"`)? Then we trim on input, no migration, FE handles dedup against the list.
- **(b)** Or does FR-024 require backend-enforced uniqueness per household? Then we also need a `unique (household_id, lower(name))` constraint on `items` (mirroring how `low_stock` already works) and a `409` on duplicate `POST /items`.
- **(c)** If (b): case-insensitive (`"Milk"` == `"MILK"`) or case-sensitive?

Please paste the FR-024 wording so we don't guess. Fix is queued; just need the spec sentence to pick (a) vs (b)/(c).

### BUG-012 — Items editable after approved/done (FR-017)

I have no record of FR-017 saying approved/done items are frozen. Two possibilities:

- FR-017 is real and we missed it → add a guard rejecting non-status PATCHes when `status in ('approved', 'done')`. Want to confirm: does this apply to **all** users, or do admins keep the ability to edit?
- FR-017 is a misread → WAI.

Please paste the FR-017 wording.

---

## 3. Blocked — need diagnostic data

### BUG-003 — Concurrent `POST /items` intermittently 500s

I can't see how 10 parallel inserts cause a 500 in our code path (no unique constraints involved). To root-cause I need **one failing response body** — the JSON `detail` field, or one server log line, from a 500 in your concurrency run.

If your test harness captures responses, can you attach the body of any one of the 500s? Without it I'd be guessing between (a) a shared HTTP client thread-safety issue, (b) PostgREST connection-pool exhaustion at the Supabase tier, and (c) a transient network blip — and the fix differs per cause.

---

## 4. Working as intended / spec mismatch — push back if you disagree

Each of these I'd leave as-is. **If your spec actually says otherwise, send the wording and I'll re-evaluate.**

### BUG-006 — Stored-XSS in item name (HTML persisted verbatim)

Sanitizing on write loses the original text (and breaks any legitimate name containing `<` or `&`). Correct fix is **escape-on-render**, not sanitize-on-write. Today the only consumer is React Native, which renders `<Text>` as text — no HTML sink exists. The web dashboard and HTML email mentioned in your detection don't ship yet. We'll escape at render when they do.

If you have a specific exploit chain you can demonstrate today against the live mobile app, I want to see it.

### BUG-007 — `quantity` returned as `"2.0"` string, not number

Intentional. `quantity` is `Decimal` to avoid float precision loss (`0.1 + 0.2 ≠ 0.3` on shopping quantities). Pydantic v2 serializes `Decimal` to a JSON string on purpose; switching to JSON number would mean accepting precision loss. FE parses the string. I'll add a note to the API spec under serialization conventions.

### BUG-011 — Non-owner can edit another member's item

Intentional. The household shopping list is a **shared resource** — any member can adjust quantities, fix typos, mark urgent. Only `DELETE /items/{id}` is restricted to creator-or-admin. See [docs/items-flow.md](items-flow.md) and the `PATCH /items/{id}` docstring at [app/items/router.py:194-196](../backend/app/items/router.py#L194-L196).

If product has moved to per-owner editing, I need that requirement in writing (not just an API spec assertion).

### BUG-013 — Logout doesn't revoke access token + `done → pending` allowed

Two unrelated things in one report; both WAI:

- **Logout / access token**: Supabase JWTs are **stateless** by design. `auth.admin.sign_out(token, scope='local')` revokes the **refresh** token; the access token stays valid until natural `exp` (~1 hour). Backend cannot mid-life-invalidate a JWT without introducing a session blocklist table we deliberately don't have. FE clears local SecureStore on logout.
- **Status transition `done → pending`**: deliberately allowed for any member — it's the "I marked this bought by mistake, undo it" path. Documented in [app/items/router.py:228-230](../backend/app/items/router.py#L228-L230) and the items flow doc.

---

## 5. Deferred from v1

- **BUG-010** — Password change doesn't verify current password. **Acknowledged as a real risk** on the logged-in self-rotation flow: an attacker with a stolen access token could change the user's password and lock the legitimate user out. We've decided not to ship the fix in v1 to keep the password flow simple — clean fix needs a split between logged-in rotation (with current-password proof) and recovery-link flow (where the old password is, by definition, unknown), plus FE coordination on the recovery screen. **We'll revisit on the next auth-hardening pass.** In the meantime, mitigation is at the token-secrecy layer (no service_role key client-side, SecureStore on mobile, token redaction in logs).

  If your test plan considers this a release blocker, raise it — happy to escalate the priority.

---

## Process going forward

- **One bug fix = one re-test request from me.** I'll ping you per merge so the re-test is small and targeted, not a big-bang regression.
- **Open questions** above (FR-017, FR-024, BUG-003 diagnostics) block specific fixes. Anything you can paste — spec wording, response body, repro steps — moves them.
- If you find new bugs while re-testing, file as usual; I'll triage same-day if possible.

Thanks for the thorough pass.

— Belal

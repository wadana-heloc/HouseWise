# QA bug-report follow-up — backend

**To:** QA Engineer
**From:** Belal (backend)
**Date:** 2026-06-18 (updated after your 2026-06-18 reply)
**Scope:** all 13 bugs from your latest report (BUG-001..BUG-013)

Triage and status below. Sections in order of what I need from you:

1. **Fixed — please re-test** (8 bugs, BUG-008 both halves now closed)
2. **Need your input** — none currently (FR-017/018/024/012 wording received)
3. **Blocked — need diagnostic data from you** (1 bug — BUG-003)
4. **Working as intended — confirmed by you** (3 bugs)
5. **Deferred from v1** (1 bug)

### Acknowledgement on BUG-011

You were right and I was wrong. My initial WAI verdict on BUG-011 ("household items are shared, any member can edit") was based on the existing docstring at [items/router.py](../backend/app/items/router.py), not on FR-017. Once you sent the wording, the spec is unambiguous — owner-or-admin only — and BUG-011 is now fixed. I've added a calibration note to my own process: when you cite an FR I haven't seen, I should ask for the sentence before classifying anything WAI. Thanks for the push-back.

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

### BUG-011 — Non-owner could edit another member's item → now returns 403

My earlier WAI verdict on this was wrong; reopening after you sent FR-017's wording. `PATCH /items/{id}` now enforces **owner-or-admin** (mirrors the existing DELETE gate). Non-owner non-admin → `403 {"detail":"Only the item creator or an admin may edit"}`.

**Re-test:**
```bash
# Family B trying to PATCH family A's pending item → 403
curl -sS -X PATCH $BASE/items/$ITEM_FROM_A \
  -H "Authorization: Bearer $FAMILY_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Stealing"}' -w '\n%{http_code}\n'

# Family A patching own item (still pending) → 200
curl -sS -X PATCH $BASE/items/$ITEM_FROM_A \
  -H "Authorization: Bearer $FAMILY_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Renamed by me"}' -w '\n%{http_code}\n'
```

Expect `403` on B's attempt, `200` on A's own.

---

### BUG-012 — PATCH/DELETE blocked on non-pending items (FR-017/FR-018)

Both `PATCH /items/{id}` and `DELETE /items/{id}` now require `item.status == 'pending'`. Non-pending status → **409** with a body naming the offending state:

```
409 {"detail":"Cannot edit item — status is 'approved'. Only pending items are editable."}
409 {"detail":"Cannot delete item — status is 'approved'. Only pending items are deletable."}
```

**No admin carve-out** — FR-017 says "blocked" with no exception. Admin must revert via `POST /items/{id}/status` (`approved → pending`) before editing, then re-advance status.

**Re-test:**
```bash
# Admin creates an item, approves it, then tries to PATCH it → 409
ITEM=...     # POST /items returns id
curl -sS -X POST $BASE/items/$ITEM/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"approved"}'

curl -sS -X PATCH $BASE/items/$ITEM \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"trying"}' -w '\n%{http_code}\n'
# → 409, body mentions 'approved'

# Same for DELETE
curl -sS -X DELETE $BASE/items/$ITEM \
  -H "Authorization: Bearer $ADMIN_TOKEN" -w '\n%{http_code}\n'
# → 409
```

Expect `409` on both. The escape hatch (revert status → edit) is tested as `test_admin_can_edit_after_reverting_to_pending`.

---

### BUG-008 (second half) — TLD-422 enumeration → now also 401

Closed. `LoginRequest.email` no longer uses `EmailStr`; reserved-TLD and malformed-email shapes now reach Supabase and return the same `401 {"detail":"Invalid credentials"}` body. Other endpoints (signup, member create, profile update) keep `EmailStr` — only `/auth/login` was the enumeration surface.

**Re-test:**
```bash
# Reserved-TLD email (used to 422) → 401 with constant body
curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@x.test","password":"anything-Aa1!"}' -w '\n%{http_code}\n'

# Malformed (no @) → 401
curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","password":"anything-Aa1!"}' -w '\n%{http_code}\n'

# Empty email → 401
curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"","password":"anything-Aa1!"}' -w '\n%{http_code}\n'

# Known-format unknown email (regression check) → still 401
curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody-12345@gmail.com","password":"wrong-Aa1!"}' -w '\n%{http_code}\n'
```

All four must print `401  {"detail":"Invalid credentials"}` — identical bodies.

---

### BUG-004 + BUG-005 — Trim names + reject empty (FR-012 + FR-024)

`items.name` and `low_stock.name` on create/update now use `StringConstraints(strip_whitespace=True, min_length=1, max_length=120)`. Leading/trailing whitespace is stripped before storage; whitespace-only → 422 (FR-012).

**Per FR-024 we did NOT** add a `unique (...)` constraint on items — duplicates are allowed by design with FE soft warning. `low_stock`'s existing case-insensitive unique constraint stays as-is (different feature, different requirements).

**Re-test:**
```bash
# Whitespace-only item name → 422
curl -sS -X POST $BASE/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"   ","category":"dairy","quantity":1,"unit":"L"}' \
  -w '\n%{http_code}\n'

# Trimmed on save → 201 with "name":"Milk"
curl -sS -X POST $BASE/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"  Milk  ","category":"dairy","quantity":1,"unit":"L"}' \
  -w '\n%{http_code}\n'

# Same for /low-stock — empty rejected, trimmed value collides with existing unique (trim made it work right)
curl -sS -X POST $BASE/low-stock -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"   "}' -w '\n%{http_code}\n'
curl -sS -X POST $BASE/low-stock -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"  Bread  "}' -w '\n%{http_code}\n'
```

Expect `422` on whitespace-only, `201` with trimmed `name` on the others.

---

## 2. Need your input — wording / spec questions

**Status:** all unblocked. You provided FR-017 (BUG-011 / BUG-012), FR-018 (BUG-012 delete half), FR-024 (BUG-004 / BUG-005), and FR-012 (BUG-004 empty-name half) in your 2026-06-18 reply.

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

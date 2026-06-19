# FE handoff — strict input validation (BUG-009)

**Date:** 2026-06-17
**TL;DR:** Backend now **rejects unknown keys** in every write request body with `422`. If you're sending extra/dead fields anywhere, those calls will start failing. Most likely impact: zero — but please skim the checklist below before the next mobile build hits the server.

---

## What changed

Every `POST` / `PATCH` request body schema now has `extra="forbid"` enforced by Pydantic. Sending a key the backend doesn't know about produces:

```json
{
  "detail": [
    {
      "type": "extra_forbidden",
      "loc": ["body", "<the offending key>"],
      "msg": "Extra inputs are not permitted",
      "input": "<the offending value>"
    }
  ]
}
```

Status code: `422 Unprocessable Entity`.

**Before:** unknown keys were silently dropped → request succeeded with the unknown key ignored.
**After:** unknown keys are a hard fail → 422 explicitly naming the bad key.

---

## Why we did it

QA flagged that an FE typo (e.g. `qty` instead of `quantity` on `POST /items`) currently succeeds and creates an item with `quantity=1` (the default), with no signal that the typo was dropped. That's invisible failure mode. Now you'll see the 422 immediately and know exactly which key to fix.

This is **not** a security fix — backend handlers never blindly forwarded request bodies to the DB, so the silent-drop wasn't a mass-assignment hole. It's a DX fix.

---

## Affected endpoints (all of them, basically)

Every write endpoint. The strict mode applies to:

- `POST /auth/signup`, `POST /auth/login`, `POST /auth/password-reset`, `POST /auth/password-update`
- `POST /items`, `PATCH /items/{id}`, `POST /items/{id}/status`, `POST /items/scan-image`
- `POST /low-stock`
- `POST /stores`, `PATCH /stores/{id}`
- `POST /household/members`, `PATCH /household/members/{id}`, `POST /household/members/{id}/password`, `PATCH /household/report-settings`
- `PATCH /me/profile`, `PATCH /me/health-preferences`, `PATCH /me/dietary-preferences`
- `POST /cookbook/recipes`, `PATCH /cookbook/recipes/{id}`, `POST /cookbook/recipes/generate`, `POST /cookbook/recipes/extract-photo`
- `POST /meal-plan/submissions`, `POST /meal-plan/generate`, `PATCH /meal-plan/{plan}/days/{day}`, `POST /meal-plan/{plan}/react`

---

## What to check on your side

A quick pass through your API client code for each screen that POSTs/PATCHes. Look for:

1. **Hand-rolled request bodies** that include client-side flags the backend doesn't accept. Common culprits:
   - Local debugging fields like `clientId`, `localTimestamp`, `_dirty`, `sentFromOffline`.
   - "Forward-compatible" optimistic-update markers.
   - Leftover keys from a previous API revision.

2. **Spread/passthrough patterns** like:
   ```ts
   await api.post('/items', { ...formState, ...defaultMeta })
   ```
   If `formState` or `defaultMeta` carries keys the backend doesn't model, the spread will fail. Pick only the keys you intend to send.

3. **Optimistic update payloads.** If your reducer builds the request body off the local model, the local model might have more fields than the wire contract (e.g. `localId`, `optimistic: true`). Strip them at the boundary.

4. **PATCH bodies with omitted fields you used to send as `null`.** If you've been sending `{"display_name": null, "email": "new@x.com"}` to clear a field, that's fine — `null` is a known value type. This change only rejects keys the schema doesn't have **at all**.

---

## When you spot a violation

If your build starts catching `422 extra_forbidden`, two options:

**(a) The key was a dead field — remove it.** This is the common case and the bug we wanted to surface. Just delete the line from the FE payload.

**(b) The key was intentional and we should accept it.** Then it's a backend schema gap — ping me with the endpoint + the key name + what it represents, and I'll add it to the schema.

Do **not** start sending random keys "just in case". That's what we're trying to stop.

---

## What the response looks like in practice

Example: typo'd `quantity` as `qty` on `POST /items`.

```http
POST /items
Authorization: Bearer ...
Content-Type: application/json

{"name":"Milk","category":"dairy","qty":1,"unit":"L"}
```

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "detail": [
    {
      "type": "extra_forbidden",
      "loc": ["body", "qty"],
      "msg": "Extra inputs are not permitted",
      "input": 1
    },
    {
      "type": "missing",
      "loc": ["body", "quantity"],
      "msg": "Field required",
      "input": {"name": "Milk", "category": "dairy", "qty": 1, "unit": "L"}
    }
  ]
}
```

Two errors in this case — `qty` is unknown, and `quantity` is missing. Your error-banner code should already handle 422 generically; you just have a richer detail list now.

---

## How to verify a single request quickly

```ts
// In a dev REPL / scratch screen
const r = await fetch(`${BASE}/items`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Milk', category: 'dairy', quantity: 1, unit: 'L', ghost: true }),
});
console.log(r.status, await r.json());
```

Expect `422` and a `detail[0].loc = ["body", "ghost"]`. If you see `201`, the change hasn't deployed yet — check with me.

---

## Out of scope (for now)

- **Nested request models** are still permissive. e.g. inside `POST /meal-plan/submissions`, the per-meal-request objects (`{description, recipe_id}`) will silently drop extra keys today. If you'd like that tightened too, ping me — quick follow-up.
- **Response payloads** are unchanged. The backend may still add new fields to responses without coordinating; consume `response.foo` defensively.

---

## Rollback

If this turns out to break a screen we can't fix quickly, the revert is a one-line removal of `model_config = ConfigDict(extra="forbid")` from the affected schema. Tell me the endpoint and I'll roll that one back while you patch the FE.

— Belal

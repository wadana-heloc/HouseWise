# FE handoff — items edit/delete rules tightened

**Date:** 2026-06-18
**Why:** QA pass confirmed FR-017 (item edit) and FR-018 (item delete). Backend was previously too permissive — fixed.

**TL;DR:** `PATCH /items/{id}` and `DELETE /items/{id}` now both require:
1. Caller is the **creator** (`added_by == caller.id`) **or admin**.
2. Item status is `'pending'`.

Either rule violated → backend rejects. **This is a breaking change** for any screen that lets non-creators edit, or that allowed edits on approved/done items.

---

## What the backend rejects now

| Scenario | Status before | Status now |
| --- | --- | --- |
| Family B PATCHes family A's pending item | 200 (silent shared edit) | **403** `{"detail":"Only the item creator or an admin may edit"}` |
| Family B DELETEs family A's pending item | 403 (already) | 403 (unchanged) |
| Anyone (incl. admin) PATCHes an `in_review` / `approved` / `rejected` / `done` item | 200 | **409** `{"detail":"Cannot edit item — status is '<X>'. Only pending items are editable."}` |
| Anyone (incl. admin) DELETEs a non-pending item | 200 | **409** `{"detail":"Cannot delete item — status is '<X>'. Only pending items are deletable."}` |
| Creator PATCHes own pending item | 200 (was already allowed for any member) | 200 (still works) |
| Admin PATCHes any pending item | 200 | 200 (unchanged) |

`POST /items/{id}/status` — **not affected by this change**. Status transitions still work the same way. The state machine is the escape hatch (see below).

---

## The escape hatch — moving back to pending

If admin needs to edit/delete an item that's `approved`, `in_review`, `rejected`, or `done`:

```
POST /items/{id}/status  {"status": "pending"}   # admin only for these reversals
PATCH /items/{id}        {...}
POST /items/{id}/status  {"status": "approved"}  # if you want to re-advance
```

This matches FR-017 ("Edit is blocked for approved or purchased items" — blocked, full stop, no admin override; admin must revert state first).

For `done → pending`, **any** household member can do that (not just admin) — it's the "I marked this bought by mistake" undo path.

---

## FE changes you'll likely need

### 1. Hide the Edit button when conditions aren't met

The button should be visible only when:

```ts
const canEdit =
  item.status === 'pending' &&
  (currentUser.role === 'admin' || item.added_by === currentUser.id);
```

Same predicate for the Delete button. If you were rendering Edit/Delete on every item regardless, those calls will start 403/409ing.

### 2. Handle 409 with a useful message

If your screen ever has stale state (user tapped Edit before the screen refreshed and the item moved to `approved` in the meantime), surface the backend message:

```ts
if (response.status === 409) {
  showToast(response.data.detail);
  // optionally refresh the item to show its current status
}
```

The detail string already names the current status — e.g. `"Cannot edit item — status is 'approved'. Only pending items are editable."` — so you can show it directly or paraphrase.

### 3. Admin "edit-and-approve" workflow

If admin had a flow where editing an approved item was a single PATCH, it now needs two `POST /items/{id}/status` calls around the PATCH (revert → edit → re-approve). Worth a short loading state in the UI; backend doesn't bundle these into one call.

---

## Quick test

```bash
TOKEN_ADMIN=...
TOKEN_FAM_A=...   # family member who created the item
TOKEN_FAM_B=...   # different family member
ITEM=...

# Family B → 403
curl -sS -X PATCH $BASE/items/$ITEM \
  -H "Authorization: Bearer $TOKEN_FAM_B" \
  -H "Content-Type: application/json" \
  -d '{"name":"trying"}' -w '\n%{http_code}\n'

# Family A on own pending → 200
curl -sS -X PATCH $BASE/items/$ITEM \
  -H "Authorization: Bearer $TOKEN_FAM_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Edited by owner"}' -w '\n%{http_code}\n'

# Admin approves it, then tries to PATCH → 409
curl -sS -X POST $BASE/items/$ITEM/status \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'

curl -sS -X PATCH $BASE/items/$ITEM \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"name":"trying again"}' -w '\n%{http_code}\n'
```

Expect: B → 403, A own pending → 200, admin on approved → 409.

---

## Related: `quantity` is a JSON string, not a number

While we're talking — QA called out that the TypeScript contract has `quantity: number`, but the backend serializes `Decimal` as a JSON string for precision (`"2.0"`, not `2.0`). Please update the type to `quantity: string` and parse on the FE if you need numeric ops. The serialization is intentional and won't change.

---

## Rollback

The change is purely a tightening — backend rejecting things it used to accept. If anything blocks an FE flow we can't redesign quickly, the rollback is removing the new gates in `update_item` / `delete_item`. Tell me which and I'll back it out while you patch.

— Belal

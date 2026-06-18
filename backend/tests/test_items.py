"""Integration tests for /items — real Supabase, no DB mocking."""
from tests.conftest import strong_password, unique_email
from tests.test_auth import _create_member, _signup_admin


def _item_payload(**overrides) -> dict:
    base = {
        "name": "Whole milk 2L",
        "category": "dairy",
        "quantity": 2,
        "unit": "L",
        "urgent": False,
        "notes": None,
    }
    base.update(overrides)
    return base


def _create_item(client, token, **overrides) -> dict:
    r = client.post(
        "/items",
        headers={"Authorization": f"Bearer {token}"},
        json=_item_payload(**overrides),
    )
    assert r.status_code == 201, r.text
    return r.json()


def _member_token(client, admin, member) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


# ---------- Create ----------

def test_admin_creates_item(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"], name="Orange juice", category="drinks", unit="bottles", quantity=2)
    assert item["status"] == "pending"
    assert item["added_by"] == admin["user_id"]
    assert item["household_id"] == admin["household_id"]
    assert item["name"] == "Orange juice"
    assert item["category"] == "drinks"
    assert item["unit"] == "bottles"


def test_family_creates_item(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)

    item = _create_item(client, fam_token, name="Tomatoes 1kg", category="produce", unit="kg", quantity=1, urgent=True)
    assert item["added_by"] == member["user_id"]
    assert item["household_id"] == admin["household_id"]
    assert item["urgent"] is True


def test_create_without_bearer_returns_401(client):
    r = client.post("/items", json=_item_payload())
    assert r.status_code in (401, 422)


def test_create_with_bad_enum_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    bad_cat = client.post(
        "/items",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_item_payload(category="garbage"),
    )
    assert bad_cat.status_code == 422

    bad_unit = client.post(
        "/items",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_item_payload(unit="furlongs"),
    )
    assert bad_unit.status_code == 422


def test_create_with_non_positive_quantity_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_item_payload(quantity=0),
    )
    assert r.status_code == 422


# ---------- List & isolation ----------

def test_list_returns_only_callers_household(client, created_users):
    admin1 = _signup_admin(client, created_users, household_name="H1")
    admin2 = _signup_admin(client, created_users, household_name="H2")
    _create_item(client, admin1["access_token"], name="A1-milk")
    _create_item(client, admin2["access_token"], name="A2-bread", category="bakery", unit="loaves")

    r = client.get("/items", headers={"Authorization": f"Bearer {admin1['access_token']}"})
    assert r.status_code == 200
    names = [i["name"] for i in r.json()["items"]]
    assert "A1-milk" in names
    assert "A2-bread" not in names


def test_list_filters(client, created_users):
    admin = _signup_admin(client, created_users)
    _create_item(client, admin["access_token"], name="urgent-dairy", category="dairy", unit="L", urgent=True)
    _create_item(client, admin["access_token"], name="calm-dairy", category="dairy", unit="L", urgent=False)
    _create_item(client, admin["access_token"], name="calm-meat", category="meat", unit="kg", urgent=False)

    r = client.get(
        "/items?status=pending&urgent=true&category=dairy",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    names = [i["name"] for i in r.json()["items"]]
    assert names == ["urgent-dairy"]


def test_non_uuid_item_id_returns_422(client, created_users):
    """Invalid UUID in the path should fail validation before the handler runs,
    not bubble up as a 500 from Postgres trying to cast '555'::uuid."""
    admin = _signup_admin(client, created_users)
    headers = {"Authorization": f"Bearer {admin['access_token']}"}
    for method, path in [
        ("GET", "/items/555"),
        ("PATCH", "/items/555"),
        ("POST", "/items/555/status"),
        ("DELETE", "/items/555"),
    ]:
        kwargs = {"headers": headers}
        if method == "PATCH":
            kwargs["json"] = {"name": "x"}
        elif method == "POST":
            kwargs["json"] = {"status": "done"}
        r = client.request(method, path, **kwargs)
        assert r.status_code == 422, f"{method} {path} -> {r.status_code}: {r.text}"


def test_get_single_item_cross_household_returns_404(client, created_users):
    admin1 = _signup_admin(client, created_users, household_name="H1")
    admin2 = _signup_admin(client, created_users, household_name="H2")
    item = _create_item(client, admin1["access_token"], name="hidden")

    r = client.get(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin2['access_token']}"},
    )
    assert r.status_code == 404


# ---------- PATCH ----------

def test_patch_updates_fields_and_bumps_updated_at(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    before = item["updated_at"]

    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Skim milk 1L", "quantity": 3, "notes": "for cereal"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Skim milk 1L"
    assert float(body["quantity"]) == 3.0
    assert body["notes"] == "for cereal"
    assert body["updated_at"] > before


def test_patch_empty_body_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={},
    )
    assert r.status_code == 422


def test_patch_cross_household_returns_404(client, created_users):
    admin1 = _signup_admin(client, created_users, household_name="H1")
    admin2 = _signup_admin(client, created_users, household_name="H2")
    item = _create_item(client, admin1["access_token"])
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin2['access_token']}"},
        json={"name": "stolen"},
    )
    assert r.status_code == 404


# ---------- Status transitions ----------

def test_family_can_mark_done(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)
    item = _create_item(client, fam_token)

    r = client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"status": "done"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "done"


def test_family_cannot_set_admin_only_status(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)
    item = _create_item(client, fam_token)

    r = client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"status": "approved"},
    )
    assert r.status_code == 403


def test_admin_can_approve(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    r = client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"status": "approved"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


def test_admin_full_pipeline(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    tok = admin["access_token"]

    for s in ("in_review", "approved", "done"):
        r = client.post(
            f"/items/{item['id']}/status",
            headers={"Authorization": f"Bearer {tok}"},
            json={"status": s},
        )
        assert r.status_code == 200, (s, r.text)
        assert r.json()["status"] == s


def test_family_can_undo_done_back_to_pending(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)
    item = _create_item(client, fam_token)

    assert client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"status": "done"},
    ).status_code == 200

    r = client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"status": "pending"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending"


def test_invalid_transition_returns_400(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    # done -> approved is not a legal transition
    assert client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"status": "done"},
    ).status_code == 200
    r = client.post(
        f"/items/{item['id']}/status",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"status": "approved"},
    )
    assert r.status_code == 400


# ---------- DELETE ----------

def test_creator_can_delete_own_item(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)
    item = _create_item(client, fam_token)

    r = client.delete(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 200

    gone = client.get(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert gone.status_code == 404


def test_non_creator_family_cannot_delete(client, created_users):
    admin = _signup_admin(client, created_users)
    m1 = _create_member(client, admin["access_token"], created_users)
    m2 = _create_member(client, admin["access_token"], created_users)
    tok1 = _member_token(client, admin, m1)
    tok2 = _member_token(client, admin, m2)

    item = _create_item(client, tok1)
    r = client.delete(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {tok2}"},
    )
    assert r.status_code == 403


def test_admin_can_delete_any_household_item(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)
    item = _create_item(client, fam_token)

    r = client.delete(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200


def test_delete_cross_household_returns_404(client, created_users):
    admin1 = _signup_admin(client, created_users, household_name="H1")
    admin2 = _signup_admin(client, created_users, household_name="H2")
    item = _create_item(client, admin1["access_token"])

    r = client.delete(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin2['access_token']}"},
    )
    assert r.status_code == 404


# ---------- BUG-011: PATCH owner-or-admin gate (FR-017) ----------


def test_patch_owner_can_edit_own_pending(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)

    item = _create_item(client, fam_token)
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"name": "Edited by owner"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Edited by owner"


def test_patch_admin_can_edit_family_pending(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)

    item = _create_item(client, fam_token)
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Admin-edited"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Admin-edited"


def test_patch_non_owner_non_admin_returns_403(client, created_users):
    """Family B trying to PATCH family A's item must be 403 (FR-017)."""
    admin = _signup_admin(client, created_users)
    m1 = _create_member(client, admin["access_token"], created_users)
    m2 = _create_member(client, admin["access_token"], created_users)
    tok1 = _member_token(client, admin, m1)
    tok2 = _member_token(client, admin, m2)

    item = _create_item(client, tok1)
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {tok2}"},
        json={"name": "Stealing"},
    )
    assert r.status_code == 403, r.text
    assert "creator" in r.json()["detail"].lower() or "admin" in r.json()["detail"].lower()


# ---------- BUG-012: PATCH/DELETE blocked on non-pending status (FR-017/FR-018) ----------


def _set_status(client, token, item_id: str, new_status: str) -> dict:
    r = client.post(
        f"/items/{item_id}/status",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": new_status},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_patch_blocked_when_in_review(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    _set_status(client, admin["access_token"], item["id"], "in_review")

    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Nope"},
    )
    assert r.status_code == 409, r.text
    assert "in_review" in r.json()["detail"]


def test_patch_blocked_when_approved_even_for_admin(client, created_users):
    """No admin carve-out — FR-017 says 'blocked' full stop."""
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    _set_status(client, admin["access_token"], item["id"], "approved")

    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Nope"},
    )
    assert r.status_code == 409, r.text
    assert "approved" in r.json()["detail"]


def test_patch_blocked_when_done(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)

    item = _create_item(client, fam_token)
    _set_status(client, fam_token, item["id"], "done")

    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"name": "Nope"},
    )
    assert r.status_code == 409, r.text
    assert "done" in r.json()["detail"]


def test_delete_blocked_when_approved_even_for_admin(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    _set_status(client, admin["access_token"], item["id"], "approved")

    r = client.delete(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 409, r.text
    assert "approved" in r.json()["detail"]


def test_delete_blocked_when_done(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, admin, member)

    item = _create_item(client, fam_token)
    _set_status(client, fam_token, item["id"], "done")

    r = client.delete(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 409, r.text
    assert "done" in r.json()["detail"]


# ---------- BUG-004 + BUG-005: trim names + reject empty after trim (FR-012, FR-024) ----------


def test_create_item_whitespace_only_name_rejected(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_item_payload(name="   "),
    )
    assert r.status_code == 422, r.text


def test_create_item_trims_leading_trailing_whitespace(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_item_payload(name="  Whole milk 2L  "),
    )
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Whole milk 2L"


def test_patch_item_trims_name(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "  Bread  "},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Bread"


def test_patch_item_whitespace_only_name_rejected(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "   "},
    )
    assert r.status_code == 422, r.text


def test_admin_can_edit_after_reverting_to_pending(client, created_users):
    """FR-017 escape hatch: admin moves status back to pending then edits."""
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    _set_status(client, admin["access_token"], item["id"], "approved")
    _set_status(client, admin["access_token"], item["id"], "pending")

    r = client.patch(
        f"/items/{item['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Edited after revert"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Edited after revert"

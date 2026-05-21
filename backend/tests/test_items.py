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

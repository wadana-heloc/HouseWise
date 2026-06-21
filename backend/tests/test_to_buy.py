"""Integration tests for /to-buy — real Supabase, no DB mocking.

Covers: replace semantics, GET with item joins, mark-done sync (Direction B),
items→done auto-clear (Direction A), eligibility gates, family vs admin
permissions, cross-household 404.
"""
import uuid

from tests.test_auth import _create_member, _signup_admin


def _item_payload(**overrides) -> dict:
    base = {
        "name": "Milk 2L",
        "category": "dairy",
        "quantity": 1,
        "unit": "L",
        "urgent": False,
    }
    base.update(overrides)
    return base


def _create_item(client, token: str, **overrides) -> dict:
    r = client.post(
        "/items",
        headers={"Authorization": f"Bearer {token}"},
        json=_item_payload(**overrides),
    )
    assert r.status_code == 201, r.text
    return r.json()


def _set_status(client, token: str, item_id: str, new_status: str) -> dict:
    r = client.post(
        f"/items/{item_id}/status",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": new_status},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _entry(item_id: str, store: str = "Spinneys", url: str = "https://www.spinneys.com/en-ae/", price: str = "8.50") -> dict:
    return {
        "item_id": item_id,
        "chosen_store_url": url,
        "chosen_store_name": store,
        "chosen_price": price,
        "currency": "AED",
    }


def _member_token(client, member: dict) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


# ---------- Replace + GET ----------


def test_admin_replace_empty_list_starts_empty(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get("/to-buy", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entries"] == []
    assert body["item_count"] == 0
    assert float(body["estimated_total"]) == 0.0


def test_admin_replace_with_entries(client, created_users):
    admin = _signup_admin(client, created_users)
    item1 = _create_item(client, admin["access_token"], name="Milk")
    item2 = _create_item(client, admin["access_token"], name="Bread")

    r = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"entries": [_entry(item1["id"], price="5.50"), _entry(item2["id"], price="3.00")]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item_count"] == 2
    assert float(body["estimated_total"]) == 8.50
    names = sorted(e["item_name"] for e in body["entries"])
    assert names == ["Bread", "Milk"]


def test_replace_wipes_prior_entries(client, created_users):
    admin = _signup_admin(client, created_users)
    item1 = _create_item(client, admin["access_token"], name="Milk")
    item2 = _create_item(client, admin["access_token"], name="Bread")
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}

    client.post("/to-buy", headers=hdr, json={"entries": [_entry(item1["id"])]})
    client.post("/to-buy", headers=hdr, json={"entries": [_entry(item2["id"])]})

    body = client.get("/to-buy", headers=hdr).json()
    assert body["item_count"] == 1
    assert body["entries"][0]["item_id"] == item2["id"]


def test_replace_empty_clears_list(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}

    client.post("/to-buy", headers=hdr, json={"entries": [_entry(item["id"])]})
    r = client.post("/to-buy", headers=hdr, json={"entries": []})
    assert r.status_code == 200, r.text
    assert r.json()["item_count"] == 0


def test_family_can_get_but_cannot_replace(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)

    # GET is fine
    r = client.get("/to-buy", headers={"Authorization": f"Bearer {fam_token}"})
    assert r.status_code == 200

    # Replace is admin-only
    r = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"entries": []},
    )
    assert r.status_code == 403


def test_replace_rejects_cross_household_item(client, created_users):
    admin_a = _signup_admin(client, created_users, household_name="A")
    admin_b = _signup_admin(client, created_users, household_name="B")
    item_a = _create_item(client, admin_a["access_token"])

    r = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin_b['access_token']}"},
        json={"entries": [_entry(item_a["id"])]},
    )
    assert r.status_code == 404, r.text


def test_replace_rejects_item_in_disallowed_status(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    _set_status(client, admin["access_token"], item["id"], "in_review")

    r = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"entries": [_entry(item["id"])]},
    )
    assert r.status_code == 409, r.text
    assert "in_review" in r.json()["detail"]


def test_replace_allows_pending_and_approved(client, created_users):
    admin = _signup_admin(client, created_users)
    pending = _create_item(client, admin["access_token"], name="Pending item")
    approved = _create_item(client, admin["access_token"], name="Approved item")
    _set_status(client, admin["access_token"], approved["id"], "approved")
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}

    r = client.post(
        "/to-buy",
        headers=hdr,
        json={"entries": [_entry(pending["id"]), _entry(approved["id"])]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["item_count"] == 2


def test_replace_rejects_extra_field(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    r = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"entries": [_entry(item["id"])], "ghost": True},
    )
    assert r.status_code == 422, r.text


# ---------- Direction B sync: to_buy /done → items.done ----------


def test_to_buy_done_also_flips_items_status(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}
    body = client.post("/to-buy", headers=hdr, json={"entries": [_entry(item["id"])]}).json()
    entry_id = body["entries"][0]["id"]

    r = client.post(f"/to-buy/{entry_id}/done", headers=hdr)
    assert r.status_code == 200, r.text

    # Item is now done
    item_after = client.get(f"/items/{item['id']}", headers=hdr).json()
    assert item_after["status"] == "done"

    # To-buy entry is gone
    list_after = client.get("/to-buy", headers=hdr).json()
    assert list_after["item_count"] == 0


def test_family_can_mark_done(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    item = _create_item(client, admin["access_token"])
    body = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"entries": [_entry(item["id"])]},
    ).json()
    entry_id = body["entries"][0]["id"]

    r = client.post(
        f"/to-buy/{entry_id}/done",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 200, r.text


def test_done_cross_household_returns_404(client, created_users):
    admin_a = _signup_admin(client, created_users, household_name="A")
    admin_b = _signup_admin(client, created_users, household_name="B")
    item = _create_item(client, admin_a["access_token"])
    body = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin_a['access_token']}"},
        json={"entries": [_entry(item["id"])]},
    ).json()
    entry_id = body["entries"][0]["id"]

    r = client.post(
        f"/to-buy/{entry_id}/done",
        headers={"Authorization": f"Bearer {admin_b['access_token']}"},
    )
    assert r.status_code == 404


# ---------- Direction A sync: items.done → to_buy cleared ----------


def test_items_status_done_also_clears_to_buy(client, created_users):
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}
    client.post("/to-buy", headers=hdr, json={"entries": [_entry(item["id"])]})

    # Mark the item done via the items endpoint (Direction A)
    _set_status(client, admin["access_token"], item["id"], "done")

    list_after = client.get("/to-buy", headers=hdr).json()
    assert list_after["item_count"] == 0


def test_items_done_by_family_clears_to_buy(client, created_users):
    """Any household member marking the items row done triggers the sync."""
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    item = _create_item(client, admin["access_token"])
    hdr_admin = {"Authorization": f"Bearer {admin['access_token']}"}
    client.post("/to-buy", headers=hdr_admin, json={"entries": [_entry(item["id"])]})

    _set_status(client, fam_token, item["id"], "done")

    list_after = client.get("/to-buy", headers=hdr_admin).json()
    assert list_after["item_count"] == 0


# ---------- DELETE: no sync ----------


def test_delete_to_buy_does_not_change_item_status(client, created_users):
    """DELETE is admin's 'changed my mind' — items.status stays as it was."""
    admin = _signup_admin(client, created_users)
    item = _create_item(client, admin["access_token"])
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}
    body = client.post("/to-buy", headers=hdr, json={"entries": [_entry(item["id"])]}).json()
    entry_id = body["entries"][0]["id"]

    r = client.delete(f"/to-buy/{entry_id}", headers=hdr)
    assert r.status_code == 200, r.text

    item_after = client.get(f"/items/{item['id']}", headers=hdr).json()
    assert item_after["status"] == "pending"  # unchanged

    list_after = client.get("/to-buy", headers=hdr).json()
    assert list_after["item_count"] == 0


def test_family_cannot_delete(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    item = _create_item(client, admin["access_token"])
    body = client.post(
        "/to-buy",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"entries": [_entry(item["id"])]},
    ).json()
    entry_id = body["entries"][0]["id"]

    r = client.delete(
        f"/to-buy/{entry_id}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 403


# ---------- Misc ----------


def test_nonexistent_entry_done_returns_404(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        f"/to-buy/{uuid.uuid4()}/done",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 404


def test_get_returns_aggregate_total(client, created_users):
    admin = _signup_admin(client, created_users)
    items = [_create_item(client, admin["access_token"], name=f"Item {i}") for i in range(3)]
    hdr = {"Authorization": f"Bearer {admin['access_token']}"}
    client.post(
        "/to-buy",
        headers=hdr,
        json={
            "entries": [
                _entry(items[0]["id"], price="1.50"),
                _entry(items[1]["id"], price="2.25"),
                _entry(items[2]["id"], price="0.75"),
            ]
        },
    )
    body = client.get("/to-buy", headers=hdr).json()
    assert body["item_count"] == 3
    assert float(body["estimated_total"]) == 4.50

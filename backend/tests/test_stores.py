"""Integration tests for /stores — real Supabase, no DB mocking."""
import uuid

import pytest

from tests.test_auth import _create_member, _signup_admin


def _post(client, token, name, url):
    return client.post(
        "/stores",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "url": url},
    )


def _member_token(client, member):
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


# ---------- Create ----------

def test_admin_creates_store(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"], "Carrefour", "https://carrefour.ae")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Carrefour"
    assert body["url"].startswith("https://carrefour.ae")
    assert body["added_by"] == admin["user_id"]
    assert body["household_id"] == admin["household_id"]


def test_bare_host_is_normalized(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"], "Lulu", "lulu.com")
    assert r.status_code == 201
    assert r.json()["url"] == "https://lulu.com/"


def test_http_scheme_preserved(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"], "Local", "http://local.example.com")
    assert r.status_code == 201
    assert r.json()["url"].startswith("http://local.example.com")


@pytest.mark.parametrize("bad", ["abc", "   ", "javascript:alert(1)", "http://"])
def test_garbage_url_returns_422(client, created_users, bad):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"], "X", bad)
    assert r.status_code == 422


def test_empty_name_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"], "", "https://x.com")
    assert r.status_code == 422


def test_duplicate_name_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    assert _post(client, admin["access_token"], "Spinneys", "spinneys.com").status_code == 201
    dup = _post(client, admin["access_token"], "Spinneys", "spinneys.example")
    assert dup.status_code == 409


def test_case_insensitive_duplicate_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    assert _post(client, admin["access_token"], "Spinneys", "spinneys.com").status_code == 201
    dup = _post(client, admin["access_token"], "SPINNEYS", "spinneys.example")
    assert dup.status_code == 409


def test_family_cannot_create_store(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = _post(client, fam_token, "Forbidden", "no.example.com")
    assert r.status_code == 403


def test_post_without_bearer_returns_401(client):
    r = client.post("/stores", json={"name": "X", "url": "x.com"})
    assert r.status_code in (401, 403)


# ---------- List ----------

def test_list_orders_alphabetically(client, created_users):
    admin = _signup_admin(client, created_users)
    for name in ["Carrefour", "Aldi", "Lulu"]:
        assert _post(client, admin["access_token"], name, f"{name.lower()}.com").status_code == 201
    r = client.get("/stores", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["stores"]]
    assert names == ["Aldi", "Carrefour", "Lulu"]


def test_family_can_list(client, created_users):
    admin = _signup_admin(client, created_users)
    _post(client, admin["access_token"], "Visible", "visible.com")
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = client.get("/stores", headers={"Authorization": f"Bearer {fam_token}"})
    assert r.status_code == 200
    assert any(s["name"] == "Visible" for s in r.json()["stores"])


def test_list_isolates_by_household(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    _post(client, a1["access_token"], "H1-only", "h1.com")
    _post(client, a2["access_token"], "H2-only", "h2.com")
    r = client.get("/stores", headers={"Authorization": f"Bearer {a1['access_token']}"})
    names = [s["name"] for s in r.json()["stores"]]
    assert "H1-only" in names
    assert "H2-only" not in names


# ---------- Patch ----------

def test_admin_patches_name(client, created_users):
    admin = _signup_admin(client, created_users)
    store_id = _post(client, admin["access_token"], "OldName", "old.com").json()["id"]
    r = client.patch(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "NewName"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "NewName"


def test_admin_patches_url_normalizes(client, created_users):
    admin = _signup_admin(client, created_users)
    store_id = _post(client, admin["access_token"], "S", "first.com").json()["id"]
    r = client.patch(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"url": "second.com"},
    )
    assert r.status_code == 200
    assert r.json()["url"] == "https://second.com/"


def test_patch_empty_body_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    store_id = _post(client, admin["access_token"], "S", "s.com").json()["id"]
    r = client.patch(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={},
    )
    assert r.status_code == 422


def test_patch_to_duplicate_name_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    _post(client, admin["access_token"], "Aldi", "aldi.com")
    other_id = _post(client, admin["access_token"], "Lulu", "lulu.com").json()["id"]
    r = client.patch(
        f"/stores/{other_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Aldi"},
    )
    assert r.status_code == 409


def test_patch_cross_household_returns_404(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    store_id = _post(client, a1["access_token"], "S", "s.com").json()["id"]
    r = client.patch(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
        json={"name": "X"},
    )
    assert r.status_code == 404


def test_family_cannot_patch(client, created_users):
    admin = _signup_admin(client, created_users)
    store_id = _post(client, admin["access_token"], "S", "s.com").json()["id"]
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = client.patch(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"name": "X"},
    )
    assert r.status_code == 403


# ---------- Delete ----------

def test_admin_deletes_store(client, created_users):
    admin = _signup_admin(client, created_users)
    store_id = _post(client, admin["access_token"], "Goner", "g.com").json()["id"]
    r = client.delete(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    listing = client.get("/stores", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert all(s["id"] != store_id for s in listing.json()["stores"])


def test_delete_cross_household_returns_404(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    store_id = _post(client, a1["access_token"], "S", "s.com").json()["id"]
    r = client.delete(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
    )
    assert r.status_code == 404


def test_family_cannot_delete(client, created_users):
    admin = _signup_admin(client, created_users)
    store_id = _post(client, admin["access_token"], "S", "s.com").json()["id"]
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = client.delete(
        f"/stores/{store_id}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 403


def test_non_uuid_store_id_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    for method in ("PATCH", "DELETE"):
        kwargs = {"headers": {"Authorization": f"Bearer {admin['access_token']}"}}
        if method == "PATCH":
            kwargs["json"] = {"name": "X"}
        r = client.request(method, "/stores/not-a-uuid", **kwargs)
        assert r.status_code == 422, f"{method} -> {r.status_code}"

"""Integration tests for /low-stock — real Supabase, no DB mocking."""
import uuid

from tests.conftest import unique_email
from tests.test_auth import _create_member, _signup_admin


def _flag(client, token: str, name: str):
    return client.post(
        "/low-stock",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name},
    )


def _member_token(client, member: dict) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


# ---------- Create ----------

def test_admin_flags_item(client, created_users):
    admin = _signup_admin(client, created_users, display_name="Admin")
    r = _flag(client, admin["access_token"], "Laundry detergent")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Laundry detergent"
    assert body["added_by"] == admin["user_id"]
    assert body["added_by_display_name"] == "Admin"
    assert body["household_id"] == admin["household_id"]


def test_family_can_flag_different_name(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)

    r1 = _flag(client, admin["access_token"], "Detergent")
    r2 = _flag(client, fam_token, "Dish soap")
    assert r1.status_code == 201
    assert r2.status_code == 201

    listing = client.get("/low-stock", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert len(listing.json()["flags"]) == 2


def test_flag_with_empty_name_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _flag(client, admin["access_token"], "")
    assert r.status_code == 422


def test_flag_without_bearer_returns_401(client):
    r = client.post("/low-stock", json={"name": "X"})
    assert r.status_code in (401, 403)


def test_same_caller_same_name_twice_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    assert _flag(client, admin["access_token"], "Toilet paper").status_code == 201
    dup = _flag(client, admin["access_token"], "Toilet paper")
    assert dup.status_code == 409


def test_different_caller_same_name_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)

    assert _flag(client, admin["access_token"], "Toilet paper").status_code == 201
    dup = _flag(client, fam_token, "Toilet paper")
    assert dup.status_code == 409


def test_reflag_after_delete_succeeds(client, created_users):
    admin = _signup_admin(client, created_users)
    first = _flag(client, admin["access_token"], "Bread")
    assert first.status_code == 201
    flag_id = first.json()["id"]

    delete = client.delete(
        f"/low-stock/{flag_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert delete.status_code == 200

    again = _flag(client, admin["access_token"], "Bread")
    assert again.status_code == 201


def test_case_insensitive_duplicate_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    assert _flag(client, admin["access_token"], "Dish Soap").status_code == 201
    dup = _flag(client, admin["access_token"], "dish soap")
    assert dup.status_code == 409


def test_same_name_in_different_household_is_allowed(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    assert _flag(client, a1["access_token"], "Toilet paper").status_code == 201
    assert _flag(client, a2["access_token"], "Toilet paper").status_code == 201


# ---------- List ----------

def test_list_isolates_by_household(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    _flag(client, a1["access_token"], "H1-only")
    _flag(client, a2["access_token"], "H2-only")

    r = client.get("/low-stock", headers={"Authorization": f"Bearer {a1['access_token']}"})
    names = [f["name"] for f in r.json()["flags"]]
    assert "H1-only" in names
    assert "H2-only" not in names


def test_list_ordered_newest_first(client, created_users):
    admin = _signup_admin(client, created_users)
    for name in ["First", "Second", "Third"]:
        assert _flag(client, admin["access_token"], name).status_code == 201
    r = client.get("/low-stock", headers={"Authorization": f"Bearer {admin['access_token']}"})
    names = [f["name"] for f in r.json()["flags"]]
    assert names == ["Third", "Second", "First"]


def test_list_includes_display_name(client, created_users):
    admin = _signup_admin(client, created_users, display_name="Maha")
    _flag(client, admin["access_token"], "Soap")
    r = client.get("/low-stock", headers={"Authorization": f"Bearer {admin['access_token']}"})
    row = r.json()["flags"][0]
    assert row["added_by_display_name"] == "Maha"


# ---------- Delete ----------

def test_creator_can_delete_own_flag(client, created_users):
    admin = _signup_admin(client, created_users)
    flag_id = _flag(client, admin["access_token"], "Soap").json()["id"]
    r = client.delete(
        f"/low-stock/{flag_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    listing = client.get("/low-stock", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert all(f["id"] != flag_id for f in listing.json()["flags"])


def test_any_household_member_can_delete(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    flag_id = _flag(client, admin["access_token"], "Detergent").json()["id"]

    r = client.delete(
        f"/low-stock/{flag_id}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 200


def test_delete_cross_household_returns_404(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    flag_id = _flag(client, a1["access_token"], "Soap").json()["id"]

    r = client.delete(
        f"/low-stock/{flag_id}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
    )
    assert r.status_code == 404


def test_delete_nonexistent_returns_404(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.delete(
        f"/low-stock/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 404


def test_delete_non_uuid_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.delete(
        "/low-stock/not-a-uuid",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 422


# ---------- BUG-004: trim name + reject empty after trim (FR-012) ----------


def test_create_low_stock_whitespace_only_name_rejected(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _flag(client, admin["access_token"], "   ")
    assert r.status_code == 422, r.text


def test_create_low_stock_trims_name(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _flag(client, admin["access_token"], "  Bread  ")
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Bread"

    # Follow-up: same trimmed value now collides with the unique constraint.
    dup = _flag(client, admin["access_token"], "Bread")
    assert dup.status_code == 409, dup.text

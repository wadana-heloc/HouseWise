"""Integration tests for /me/* — profile + health-preferences."""
from tests.conftest import strong_password, unique_email
from tests.test_auth import _create_member, _signup_admin


def _me(client, token: str) -> dict:
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- PATCH /me/profile ----------

def test_patch_profile_display_name(client, created_users):
    admin = _signup_admin(client, created_users, display_name="Old Name")
    r = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"display_name": "New Name"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "New Name"
    assert _me(client, admin["access_token"])["user"]["display_name"] == "New Name"


def test_patch_profile_email_changes_login(client, sb, created_users):
    admin = _signup_admin(client, created_users)
    new_email = unique_email()

    r = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"email": new_email},
    )
    assert r.status_code == 200, r.text
    assert r.json()["email"] == new_email

    old_login = client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]})
    assert old_login.status_code == 401
    new_login = client.post("/auth/login", json={"email": new_email, "password": admin["password"]})
    assert new_login.status_code == 200

    auth_row = sb.auth.admin.get_user_by_id(admin["user_id"]).user
    assert auth_row.email == new_email
    pub_row = sb.table("users").select("email").eq("id", admin["user_id"]).single().execute().data
    assert pub_row["email"] == new_email


def test_patch_profile_both_fields(client, created_users):
    admin = _signup_admin(client, created_users, display_name="A")
    new_email = unique_email()
    r = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"display_name": "Z", "email": new_email},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "Z"
    assert body["email"] == new_email


def test_patch_profile_email_conflict_returns_409(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    r = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
        json={"email": a1["email"]},
    )
    assert r.status_code == 409


def test_patch_profile_malformed_email_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"email": "not-an-email"},
    )
    assert r.status_code == 422


def test_patch_profile_empty_body_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={},
    )
    assert r.status_code == 422


def test_patch_profile_without_bearer_returns_401(client):
    r = client.patch("/me/profile", json={"display_name": "X"})
    assert r.status_code in (401, 403)


# ---------- GET /me + health preferences ----------

def test_fresh_signup_has_default_health_preferences(client, created_users):
    admin = _signup_admin(client, created_users)
    body = _me(client, admin["access_token"])
    prefs = body["user"]["health_preferences"]
    assert prefs == {
        "high_protein": False,
        "low_calories": False,
        "low_carbs": False,
        "low_sugar": False,
        "whole_grain": False,
    }


# ---------- PATCH /me/health-preferences ----------

def test_patch_health_preferences_single_toggle(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        "/me/health-preferences",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"high_protein": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["high_protein"] is True
    assert body["low_calories"] is False
    assert body["whole_grain"] is False


def test_patch_health_preferences_all_five(client, created_users):
    admin = _signup_admin(client, created_users)
    all_true = {k: True for k in ("high_protein", "low_calories", "low_carbs", "low_sugar", "whole_grain")}
    r = client.patch(
        "/me/health-preferences",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=all_true,
    )
    assert r.status_code == 200
    assert r.json() == all_true


def test_patch_health_preferences_merge_preserves_unsent_keys(client, created_users):
    admin = _signup_admin(client, created_users)
    headers = {"Authorization": f"Bearer {admin['access_token']}"}

    assert client.patch("/me/health-preferences", headers=headers, json={"high_protein": True, "low_sugar": True}).status_code == 200
    r = client.patch("/me/health-preferences", headers=headers, json={"low_calories": True})
    assert r.status_code == 200
    body = r.json()
    assert body["high_protein"] is True
    assert body["low_sugar"] is True
    assert body["low_calories"] is True
    assert body["low_carbs"] is False
    assert body["whole_grain"] is False


def test_patch_health_preferences_unknown_key_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        "/me/health-preferences",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"high_protein": True, "fiber": True},
    )
    assert r.status_code == 422


def test_patch_health_preferences_empty_body_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        "/me/health-preferences",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={},
    )
    assert r.status_code == 422


def test_patch_health_preferences_without_bearer_returns_401(client):
    r = client.patch("/me/health-preferences", json={"high_protein": True})
    assert r.status_code in (401, 403)


def test_health_preferences_are_per_user(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]

    assert client.patch(
        "/me/health-preferences",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"high_protein": True},
    ).status_code == 200

    fam_prefs = _me(client, fam_token)["user"]["health_preferences"]
    assert fam_prefs["high_protein"] is False, "Admin's pref leaked into family member's profile"

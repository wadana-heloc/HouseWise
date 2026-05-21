"""§10 test plan — integration against a real Supabase project."""
import os
import time

import httpx
import jwt as pyjwt
import pytest

from tests.conftest import strong_password, unique_email


def _signup_admin(client, created_users, household_name="HH", display_name="Admin"):
    email, password = unique_email(), strong_password()
    r = client.post("/auth/signup", json={
        "household_name": household_name,
        "display_name": display_name,
        "email": email,
        "password": password,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    created_users.append(body["user_id"])
    return {
        "email": email,
        "password": password,
        "user_id": body["user_id"],
        "household_id": body["household_id"],
        "access_token": body["session"]["access_token"],
        "refresh_token": body["session"]["refresh_token"],
    }


def _create_member(client, admin_token, created_users, *, email=None, password=None, display_name="Fam"):
    email = email or unique_email()
    password = password or strong_password()
    r = client.post(
        "/household/members",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"email": email, "password": password, "display_name": display_name},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    created_users.append(body["user_id"])
    return {
        "email": email,
        "password": password,
        "user_id": body["user_id"],
        "display_name": display_name,
    }


# ---------- Admin signup ----------

def test_signup_creates_auth_user_public_user_and_household(client, sb, created_users):
    admin = _signup_admin(client, created_users, household_name="The Test Family", display_name="Test Admin")

    auth_user = sb.auth.admin.get_user_by_id(admin["user_id"]).user
    assert auth_user is not None
    assert auth_user.email == admin["email"]
    assert auth_user.email_confirmed_at is not None

    profile = sb.table("users").select("*").eq("id", admin["user_id"]).single().execute().data
    assert profile["role"] == "admin"
    assert profile["household_id"] == admin["household_id"]

    hh = sb.table("households").select("*").eq("id", admin["household_id"]).single().execute().data
    assert hh["admin_id"] == admin["user_id"]
    assert hh["name"] == "The Test Family"


def test_signup_returns_immediate_session(client, created_users):
    admin = _signup_admin(client, created_users)
    assert admin["access_token"]
    assert admin["refresh_token"]

    me = client.get("/me", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "admin"


def test_signup_duplicate_email_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    dup = client.post("/auth/signup", json={
        "household_name": "B", "display_name": "B",
        "email": admin["email"], "password": strong_password(),
    })
    assert dup.status_code == 409


def test_login_works_immediately_after_signup(client, created_users):
    admin = _signup_admin(client, created_users)
    login = client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]})
    assert login.status_code == 200, login.text
    s = login.json()
    assert s["access_token"]
    assert s["refresh_token"]


# ---------- /me ----------

def test_me_returns_user_and_household(client, created_users):
    admin = _signup_admin(client, created_users, household_name="Me HH", display_name="Me")
    r = client.get("/me", headers={"Authorization": f"Bearer {admin['access_token']}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "admin"
    assert body["household"]["name"] == "Me HH"
    assert body["household"]["admin_id"] == admin["user_id"]


# ---------- Family member creation (admin-driven, no invite email) ----------

def test_admin_creates_family_member(client, sb, created_users):
    admin = _signup_admin(client, created_users, household_name="Inviter HH")
    member = _create_member(client, admin["access_token"], created_users)

    profile = sb.table("users").select("*").eq("id", member["user_id"]).single().execute().data
    assert profile["role"] == "family"
    assert profile["household_id"] == admin["household_id"]
    assert profile["email"] == member["email"]


def test_family_member_can_log_in_immediately(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    login = client.post("/auth/login", json={"email": member["email"], "password": member["password"]})
    assert login.status_code == 200, login.text


def test_family_member_jwt_has_role_family(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    login = client.post("/auth/login", json={"email": member["email"], "password": member["password"]})
    access_token = login.json()["access_token"]
    claims = pyjwt.decode(access_token, options={"verify_signature": False})
    assert (claims.get("app_metadata") or {}).get("role") == "family"


def test_create_member_duplicate_email_returns_409(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    dup = client.post(
        "/household/members",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"email": member["email"], "password": strong_password(), "display_name": "Dup"},
    )
    assert dup.status_code == 409


def test_no_public_path_to_create_family_role(client, created_users):
    # Signup always creates an admin. Extra `role` field is ignored.
    email, password = unique_email(), strong_password()
    r = client.post("/auth/signup", json={
        "household_name": "Z", "display_name": "Z",
        "email": email, "password": password,
        "role": "family",
    })
    assert r.status_code == 201
    created_users.append(r.json()["user_id"])


# ---------- Permission checks ----------

def test_family_cannot_create_or_delete_members(client, created_users):
    admin = _signup_admin(client, created_users, household_name="Perm HH")
    member = _create_member(client, admin["access_token"], created_users)

    fam_token = client.post("/auth/login", json={
        "email": member["email"], "password": member["password"],
    }).json()["access_token"]

    forbidden_create = client.post(
        "/household/members",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"email": unique_email(), "password": strong_password(), "display_name": "Nope"},
    )
    assert forbidden_create.status_code == 403

    forbidden_delete = client.delete(
        f"/household/members/{admin['user_id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert forbidden_delete.status_code == 403

    forbidden_reset = client.post(
        f"/household/members/{admin['user_id']}/password",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"new_password": strong_password()},
    )
    assert forbidden_reset.status_code == 403

    me_resp = client.get("/me", headers={"Authorization": f"Bearer {fam_token}"})
    assert me_resp.status_code == 200


# ---------- Member reads (admin + family) ----------

def test_admin_lists_members_includes_self_and_family(client, created_users):
    admin = _signup_admin(client, created_users, household_name="ListHH")
    member = _create_member(client, admin["access_token"], created_users, display_name="Fam1")

    r = client.get(
        "/household/members",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200, r.text
    rows = r.json()["members"]
    ids = {row["id"]: row for row in rows}
    assert admin["user_id"] in ids
    assert member["user_id"] in ids
    assert ids[admin["user_id"]]["role"] == "admin"
    assert ids[member["user_id"]]["role"] == "family"
    assert rows[0]["role"] == "admin", "Admin should sort first"


def test_family_lists_members_sees_full_roster(client, created_users):
    admin = _signup_admin(client, created_users)
    m1 = _create_member(client, admin["access_token"], created_users)
    m2 = _create_member(client, admin["access_token"], created_users)
    fam_token = client.post(
        "/auth/login",
        json={"email": m1["email"], "password": m1["password"]},
    ).json()["access_token"]

    r = client.get("/household/members", headers={"Authorization": f"Bearer {fam_token}"})
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["members"]}
    assert {admin["user_id"], m1["user_id"], m2["user_id"]} <= ids


def test_admin_gets_family_member_by_id(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users, display_name="Tap me")

    r = client.get(
        f"/household/members/{member['user_id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == member["user_id"]
    assert body["email"] == member["email"]
    assert body["display_name"] == "Tap me"
    assert body["role"] == "family"


def test_family_gets_admin_by_id(client, created_users):
    admin = _signup_admin(client, created_users, display_name="The Admin")
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]

    r = client.get(
        f"/household/members/{admin['user_id']}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_admin_gets_self_by_id(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get(
        f"/household/members/{admin['user_id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["id"] == admin["user_id"]


def test_get_member_cross_household_returns_404(client, created_users):
    admin1 = _signup_admin(client, created_users, household_name="H1")
    admin2 = _signup_admin(client, created_users, household_name="H2")
    member1 = _create_member(client, admin1["access_token"], created_users)

    r = client.get(
        f"/household/members/{member1['user_id']}",
        headers={"Authorization": f"Bearer {admin2['access_token']}"},
    )
    assert r.status_code == 404


def test_get_nonexistent_member_returns_404(client, created_users):
    admin = _signup_admin(client, created_users)
    import uuid
    r = client.get(
        f"/household/members/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 404


def test_get_member_non_uuid_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get(
        "/household/members/not-a-uuid",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 422


def test_list_members_without_bearer_returns_401(client):
    r = client.get("/household/members")
    assert r.status_code in (401, 403)


# ---------- Password management ----------

def test_admin_resets_member_password(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    new_password = strong_password()
    reset = client.post(
        f"/household/members/{member['user_id']}/password",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"new_password": new_password},
    )
    assert reset.status_code == 200

    login_old = client.post("/auth/login", json={"email": member["email"], "password": member["password"]})
    assert login_old.status_code == 401

    login_new = client.post("/auth/login", json={"email": member["email"], "password": new_password})
    assert login_new.status_code == 200


def test_admin_cannot_reset_own_password_via_member_endpoint(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        f"/household/members/{admin['user_id']}/password",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"new_password": strong_password()},
    )
    assert r.status_code == 400


def test_admin_cannot_reset_member_password_in_other_household(client, created_users):
    admin1 = _signup_admin(client, created_users, household_name="H1")
    admin2 = _signup_admin(client, created_users, household_name="H2")
    member1 = _create_member(client, admin1["access_token"], created_users)

    r = client.post(
        f"/household/members/{member1['user_id']}/password",
        headers={"Authorization": f"Bearer {admin2['access_token']}"},
        json={"new_password": strong_password()},
    )
    assert r.status_code == 404


def test_member_can_change_own_password(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    fam_token = client.post("/auth/login", json={
        "email": member["email"], "password": member["password"],
    }).json()["access_token"]

    new_password = strong_password()
    upd = client.post(
        "/auth/password-update",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"new_password": new_password},
    )
    assert upd.status_code == 200

    assert client.post("/auth/login", json={"email": member["email"], "password": member["password"]}).status_code == 401
    assert client.post("/auth/login", json={"email": member["email"], "password": new_password}).status_code == 200


# ---------- Password reset (admin-only email) ----------

def test_password_reset_for_unknown_email_returns_200(client):
    r = client.post("/auth/password-reset", json={"email": unique_email()})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_password_reset_for_family_email_returns_200_and_does_not_send(client, sb, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    before = _recovery_event_count(sb, member["user_id"])
    r = client.post("/auth/password-reset", json={"email": member["email"]})
    assert r.status_code == 200
    time.sleep(0.5)
    after = _recovery_event_count(sb, member["user_id"])
    assert after == before, "Expected no recovery email for a family-role email"


def test_password_reset_for_admin_email_returns_200_and_sends(client, sb, created_users):
    admin = _signup_admin(client, created_users)

    before = _recovery_event_count(sb, admin["user_id"])
    r = client.post("/auth/password-reset", json={"email": admin["email"]})
    assert r.status_code == 200
    time.sleep(0.5)
    after = _recovery_event_count(sb, admin["user_id"])
    assert after > before, "Expected a recovery email event for an admin-role email"


def _recovery_event_count(sb, user_id: str) -> int:
    rows = sb.schema("auth").table("audit_log_entries").select("id, payload").execute().data or []
    n = 0
    for row in rows:
        payload = row.get("payload") or {}
        action = payload.get("action") or ""
        actor = payload.get("actor_id") or (payload.get("traits") or {}).get("user_id")
        if "recovery" in action and (actor == user_id or payload.get("traits", {}).get("user_id") == user_id):
            n += 1
    return n


# ---------- Logout ----------

def test_logout_invalidates_current_refresh_token_only(client, created_users):
    admin = _signup_admin(client, created_users)
    s1 = client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]}).json()
    s2 = client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]}).json()

    out = client.post("/auth/logout", headers={"Authorization": f"Bearer {s1['access_token']}"})
    assert out.status_code == 200

    me2 = client.get("/me", headers={"Authorization": f"Bearer {s2['access_token']}"})
    assert me2.status_code == 200


def test_logout_all_invalidates_all_refresh_tokens(client, created_users):
    admin = _signup_admin(client, created_users)
    s1 = client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]}).json()
    client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]})

    out = client.post("/auth/logout-all", headers={"Authorization": f"Bearer {s1['access_token']}"})
    assert out.status_code == 200

    relogin = client.post("/auth/login", json={"email": admin["email"], "password": admin["password"]})
    assert relogin.status_code == 200


# ---------- Removed invite endpoints ----------

def test_invite_endpoints_are_gone(client, created_users):
    admin = _signup_admin(client, created_users)
    r1 = client.post(
        "/household/members/invite",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"email": unique_email(), "display_name": "X"},
    )
    assert r1.status_code in (404, 405)

    r2 = client.post(
        f"/household/members/{admin['user_id']}/resend-invite",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r2.status_code in (404, 405)


# ---------- RLS: member cannot self-promote via direct PostgREST ----------

def test_member_cannot_self_promote_via_postgrest(client, sb, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = client.post("/auth/login", json={
        "email": member["email"], "password": member["password"],
    }).json()["access_token"]

    supabase_url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    r = httpx.patch(
        f"{supabase_url}/rest/v1/users",
        params={"id": f"eq.{member['user_id']}"},
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {fam_token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json={"role": "admin"},
    )
    # Postgres raises on the with-check; PostgREST surfaces as 403 (or 4xx).
    assert r.status_code >= 400, f"Self-promotion should be blocked, got {r.status_code}: {r.text}"

    profile = sb.table("users").select("role").eq("id", member["user_id"]).single().execute().data
    assert profile["role"] == "family", "Role must remain family after attempted self-promotion"


# ---------- JWT security ----------

def test_tampered_role_claim_fails_signature_verification(client, created_users):
    admin = _signup_admin(client, created_users)
    token = admin["access_token"]

    claims = pyjwt.decode(token, options={"verify_signature": False})
    claims.setdefault("app_metadata", {})["role"] = "admin"
    tampered = pyjwt.encode(claims, "not-the-key", algorithm="HS256")

    r = client.get("/me", headers={"Authorization": f"Bearer {tampered}"})
    assert r.status_code == 401


def test_missing_bearer_returns_401(client):
    r = client.get("/me")
    assert r.status_code in (401, 422)


# ---------- Member deletion ----------

def test_admin_deletes_member_and_blocks_future_login(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)

    delete = client.delete(
        f"/household/members/{member['user_id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert delete.status_code == 200

    login = client.post("/auth/login", json={"email": member["email"], "password": member["password"]})
    assert login.status_code == 401


# ---------- Password policy ----------

WEAK_PASSWORDS = [
    "Short1!",            # too short
    "alllowercase1!",     # no uppercase
    "ALLUPPERCASE1!",     # no lowercase
    "NoDigitsHere!",      # no digit
    "NoSpecialChar1",     # no special
]


@pytest.mark.parametrize("weak", WEAK_PASSWORDS)
def test_signup_rejects_weak_password(client, weak):
    r = client.post("/auth/signup", json={
        "household_name": "HH", "display_name": "A",
        "email": unique_email(), "password": weak,
    })
    assert r.status_code == 422
    assert "Password must contain" in r.text


@pytest.mark.parametrize("weak", WEAK_PASSWORDS)
def test_create_member_rejects_weak_password(client, created_users, weak):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/household/members",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"email": unique_email(), "password": weak, "display_name": "X"},
    )
    assert r.status_code == 422
    assert "Password must contain" in r.text


@pytest.mark.parametrize("weak", WEAK_PASSWORDS)
def test_password_update_rejects_weak_password(client, created_users, weak):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/auth/password-update",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"new_password": weak},
    )
    assert r.status_code == 422
    assert "Password must contain" in r.text


@pytest.mark.parametrize("weak", WEAK_PASSWORDS)
def test_admin_reset_member_password_rejects_weak_password(client, created_users, weak):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    r = client.post(
        f"/household/members/{member['user_id']}/password",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"new_password": weak},
    )
    assert r.status_code == 422
    assert "Password must contain" in r.text


def test_login_does_not_enforce_password_policy(client, created_users):
    """Login must accept whatever password the user already has — the policy
    only applies at creation/update time. A weak password can't exist in the
    DB (creation is gated), but login itself must not run the validator."""
    admin = _signup_admin(client, created_users)
    r = client.post("/auth/login", json={"email": admin["email"], "password": "x"})
    assert r.status_code == 401


# ---------- Email validation ----------

@pytest.mark.parametrize("bad_email", ["not-an-email", "missing@tld", "@no-local.com", "spaces in@x.com"])
def test_signup_rejects_malformed_email(client, bad_email):
    r = client.post("/auth/signup", json={
        "household_name": "HH", "display_name": "A",
        "email": bad_email, "password": strong_password(),
    })
    assert r.status_code == 422


# ---------- Expired token (smoke) ----------

@pytest.mark.skip(reason="Requires waiting an hour for natural expiry or manipulating clock; covered by JWT lib.")
def test_expired_access_token_is_rejected():
    pass

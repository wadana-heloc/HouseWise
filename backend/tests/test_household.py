"""Integration tests for /household/report-settings — admin-only schedule."""
from tests.test_auth import _create_member, _signup_admin


_BASE = "/household/report-settings"


def _hdrs(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _member_token(client, member) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


# ---------- GET ----------


def test_get_report_settings_returns_defaults(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get(_BASE, headers=_hdrs(admin["access_token"]))
    assert r.status_code == 200, r.text
    assert r.json() == {
        "report_day": 7,
        "report_time": "09:00",
        "report_timezone": "UTC",
    }


# ---------- PATCH ----------


def test_patch_report_day_only(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(_BASE, headers=_hdrs(admin["access_token"]), json={"report_day": 3})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report_day"] == 3
    assert body["report_time"] == "09:00"
    assert body["report_timezone"] == "UTC"


def test_patch_report_time_only(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE,
        headers=_hdrs(admin["access_token"]),
        json={"report_time": "21:30"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report_day"] == 7
    assert body["report_time"] == "21:30"
    assert body["report_timezone"] == "UTC"


def test_patch_report_timezone_only(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE,
        headers=_hdrs(admin["access_token"]),
        json={"report_timezone": "Asia/Beirut"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report_day"] == 7
    assert body["report_time"] == "09:00"
    assert body["report_timezone"] == "Asia/Beirut"


def test_patch_all_three_fields(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE,
        headers=_hdrs(admin["access_token"]),
        json={
            "report_day": 1,
            "report_time": "08:00",
            "report_timezone": "Europe/London",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {
        "report_day": 1,
        "report_time": "08:00",
        "report_timezone": "Europe/London",
    }


def test_patch_persists_across_get(client, created_users):
    admin = _signup_admin(client, created_users)
    tok = admin["access_token"]
    client.patch(_BASE, headers=_hdrs(tok), json={"report_day": 5, "report_time": "12:00"})
    assert client.get(_BASE, headers=_hdrs(tok)).json() == {
        "report_day": 5,
        "report_time": "12:00",
        "report_timezone": "UTC",
    }


def test_patch_empty_body_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(_BASE, headers=_hdrs(admin["access_token"]), json={})
    assert r.status_code == 422


def test_patch_invalid_day_low(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(_BASE, headers=_hdrs(admin["access_token"]), json={"report_day": 0})
    assert r.status_code == 422


def test_patch_invalid_day_high(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(_BASE, headers=_hdrs(admin["access_token"]), json={"report_day": 8})
    assert r.status_code == 422


def test_patch_invalid_time_hour(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE, headers=_hdrs(admin["access_token"]), json={"report_time": "25:00"}
    )
    assert r.status_code == 422


def test_patch_invalid_time_minute(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE, headers=_hdrs(admin["access_token"]), json={"report_time": "09:60"}
    )
    assert r.status_code == 422


def test_patch_invalid_time_no_leading_zero(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE, headers=_hdrs(admin["access_token"]), json={"report_time": "9:00"}
    )
    assert r.status_code == 422


def test_patch_invalid_timezone(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.patch(
        _BASE,
        headers=_hdrs(admin["access_token"]),
        json={"report_timezone": "Not/A_Zone"},
    )
    assert r.status_code == 422


# ---------- Permission ----------


def test_family_get_403(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    r = client.get(_BASE, headers=_hdrs(tok))
    assert r.status_code == 403


def test_family_patch_403(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    r = client.patch(_BASE, headers=_hdrs(tok), json={"report_day": 3})
    assert r.status_code == 403


def test_unauthenticated_401(client):
    assert client.get(_BASE).status_code in (401, 403)
    assert client.patch(_BASE, json={"report_day": 3}).status_code in (401, 403)

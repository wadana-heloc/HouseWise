"""Chaos / robustness tests — anti-recursion-bomb on inbound JSON."""
from tests.test_auth import _signup_admin


def _nested_payload(depth: int) -> str:
    """Build a JSON string with `{...}` nested `depth` levels deep."""
    return "{" * depth + '"x": 1' + "}" * depth


def test_normal_payload_passes(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={
            "Authorization": f"Bearer {admin['access_token']}",
            "Content-Type": "application/json",
        },
        json={"name": "Milk", "category": "dairy", "quantity": 1, "unit": "L"},
    )
    assert r.status_code == 201, r.text


def test_excessive_nesting_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={
            "Authorization": f"Bearer {admin['access_token']}",
            "Content-Type": "application/json",
        },
        data=_nested_payload(50),
    )
    assert r.status_code == 422, r.text
    assert "depth" in r.json()["detail"].lower()


def test_boundary_depth_passes(client, created_users):
    """Depth exactly 32 must clear the middleware — Pydantic will then 422
    on schema, but the message must not mention 'depth'."""
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={
            "Authorization": f"Bearer {admin['access_token']}",
            "Content-Type": "application/json",
        },
        data=_nested_payload(32),
    )
    assert r.status_code == 422
    assert "depth" not in str(r.json()).lower()


def test_boundary_depth_plus_one_fails(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={
            "Authorization": f"Bearer {admin['access_token']}",
            "Content-Type": "application/json",
        },
        data=_nested_payload(33),
    )
    assert r.status_code == 422
    assert "depth" in r.json()["detail"].lower()


# BUG-009: unknown request fields → 422, not silently dropped.
def test_unknown_field_rejected(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Milk", "category": "dairy", "quantity": 1, "unit": "L", "ghost": True},
    )
    assert r.status_code == 422, r.text
    assert "ghost" in r.text

"""Integration tests for POST /items/scan-image.

This is the one place in the suite where mocking is correct per CLAUDE.md §5:
EasyOCR + Anthropic are external services, not our DB. We monkey-patch the
agent's `analyze_product_image` to return canned shapes. Auth still runs
against real Supabase (`_signup_admin` from test_auth).
"""
import sys
from dataclasses import dataclass

import pytest

from tests.test_auth import _signup_admin


@dataclass
class _FakeResult:
    """Mirrors the agent's ProductAnalysisResult shape (.name/.brand/.size/.reason)."""

    name: str | None
    brand: str | None
    size: str | None
    reason: str | None


@pytest.fixture
def patch_agent(monkeypatch):
    """Replace `image_agent.analyze_product_image` with a fake the test controls."""
    calls: list[tuple[str, str]] = []
    result_holder: dict = {"result": _FakeResult(None, None, None, "Agent error: not patched")}

    def fake(image_base64: str, media_type: str):
        calls.append((image_base64[:20], media_type))
        return result_holder["result"]

    # The endpoint imports `image_agent` lazily via `from image_agent import ...`,
    # so we install a synthetic module on sys.modules and patch its attribute.
    import types
    mod = types.ModuleType("image_agent")
    mod.analyze_product_image = fake
    monkeypatch.setitem(sys.modules, "image_agent", mod)

    def set_result(name=None, brand=None, size=None, reason=None):
        result_holder["result"] = _FakeResult(name=name, brand=brand, size=size, reason=reason)

    return type("PatchHandle", (), {"set": staticmethod(set_result), "calls": calls})


def _payload(image="abc123", media="image/jpeg") -> dict:
    return {"image_base64": image, "media_type": media}


# ---------- Happy paths ----------

def test_full_result_returns_200(client, created_users, patch_agent):
    admin = _signup_admin(client, created_users)
    patch_agent.set(name="Whole milk", brand="Almarai", size="2L", reason=None)

    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"name": "Whole milk", "brand": "Almarai", "size": "2L", "reason": None}


def test_partial_result_preserves_nulls(client, created_users, patch_agent):
    admin = _signup_admin(client, created_users)
    patch_agent.set(name="Milk", brand=None, size=None, reason=None)

    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Milk"
    assert body["brand"] is None
    assert body["size"] is None
    assert body["reason"] is None


def test_no_text_detected_returns_200_with_reason(client, created_users, patch_agent):
    admin = _signup_admin(client, created_users)
    patch_agent.set(name=None, brand=None, size=None, reason="No text detected in image")

    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(),
    )
    assert r.status_code == 200
    assert r.json()["reason"] == "No text detected in image"


def test_agent_error_returns_200_pass_through(client, created_users, patch_agent):
    admin = _signup_admin(client, created_users)
    patch_agent.set(name=None, brand=None, size=None, reason="Agent error: rate-limited")

    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(),
    )
    assert r.status_code == 200, "Agent failures are pass-through, never 5xx"
    assert r.json()["reason"] == "Agent error: rate-limited"


# ---------- Input validation ----------

def test_bad_media_type_returns_422(client, created_users, patch_agent):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(media="image/svg+xml"),
    )
    assert r.status_code == 422


def test_empty_image_base64_returns_422(client, created_users, patch_agent):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(image=""),
    )
    assert r.status_code == 422


def test_oversized_image_returns_422(client, created_users, patch_agent):
    from app.items.schemas import SCAN_IMAGE_MAX_BASE64
    admin = _signup_admin(client, created_users)
    too_big = "a" * (SCAN_IMAGE_MAX_BASE64 + 1)
    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json=_payload(image=too_big),
    )
    assert r.status_code == 422
    assert "image_base64" in r.text


# ---------- Auth ----------

def test_missing_bearer_returns_401(client, patch_agent):
    r = client.post("/items/scan-image", json=_payload())
    assert r.status_code in (401, 403)


def test_caller_without_household_returns_403(client, sb, created_users, patch_agent):
    """A bare auth.users row with no public.users.household_id row → 403.

    Simulated by creating a Supabase user via the admin API, then forcing
    public.users.household_id to NULL after signup-trigger creates the stub.
    """
    import uuid as uuid_mod
    email = f"orphan+{uuid_mod.uuid4().hex[:8]}@housewise.test"
    password = "Aa1!stronglongenough"
    created = sb.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"role": "family"},
        "user_metadata": {"display_name": "Orphan"},
    })
    user_id = created.user.id
    created_users.append(user_id)

    sb.table("users").update({"household_id": None}).eq("id", user_id).execute()

    login = client.post("/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    r = client.post(
        "/items/scan-image",
        headers={"Authorization": f"Bearer {token}"},
        json=_payload(),
    )
    assert r.status_code == 403

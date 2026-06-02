"""Integration tests for /cookbook — real Supabase for auth + DB; AI agents mocked.

Mocking pattern (same as test_items_scan.py): inject a synthetic module into
sys.modules so the lazy `from cookbook_agent import generate_recipe` inside
the router resolves to our fake. Anthropic itself is never called.
"""
import sys
import types
import uuid

import pytest

from tests.conftest import unique_email
from tests.test_auth import _create_member, _signup_admin


def _basic_recipe_payload(**overrides) -> dict:
    base = {
        "name": "Tomato pasta",
        "description": "A simple weeknight dinner.",
        "ingredients": [
            {"name": "Pasta", "quantity": "200", "unit": "g", "category": "grains"},
            {"name": "Tomato sauce", "quantity": "1", "unit": "jar", "category": "pantry"},
        ],
        "instructions": "Boil pasta. Heat sauce. Combine.",
        "tags": ["quick"],
        "prep_minutes": 20,
        "servings": 4,
    }
    base.update(overrides)
    return base


def _member_token(client, member) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


def _post(client, token, payload=None, path="/cookbook/recipes"):
    return client.post(
        path,
        headers={"Authorization": f"Bearer {token}"},
        json=payload if payload is not None else _basic_recipe_payload(),
    )


# ---------- Mock the two AI agent modules globally for this file ----------

class _FakeResult(dict):
    """Dict-like return shape that matches what the AI agents emit."""
    def __init__(self, **kw):
        super().__init__()
        defaults = {
            "name": None, "description": None, "ingredients": [],
            "instructions": None, "tags": [],
            "prep_minutes": None, "servings": None, "reason": None,
        }
        defaults.update(kw)
        self.update(defaults)


@pytest.fixture
def patch_cookbook_agent(monkeypatch):
    """Replace `cookbook_agent.generate_recipe` with a fake the test controls."""
    holder = {"result": _FakeResult(reason="not patched")}
    calls: list = []

    def fake_generate(prompt, household_context):
        calls.append((prompt, household_context))
        return holder["result"]

    def fake_personalize(*a, **kw):
        return ""

    mod = types.ModuleType("cookbook_agent")
    mod.generate_recipe = fake_generate
    mod.personalize_recipe_description = fake_personalize
    monkeypatch.setitem(sys.modules, "cookbook_agent", mod)

    def set_result(**kw):
        holder["result"] = _FakeResult(**kw)
    return type("H", (), {"set": staticmethod(set_result), "calls": calls})


@pytest.fixture
def patch_photo_agent(monkeypatch):
    holder = {"result": _FakeResult(reason="not patched")}

    def fake_extract(image_base64, media_type):
        return holder["result"]

    mod = types.ModuleType("recipe_photo_agent")
    mod.extract_recipe_from_image = fake_extract
    monkeypatch.setitem(sys.modules, "recipe_photo_agent", mod)

    def set_result(**kw):
        holder["result"] = _FakeResult(**kw)
    return type("H", (), {"set": staticmethod(set_result)})


# ---------- Manual create ----------

def test_admin_manual_create_is_approved(client, sb, created_users):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "manual"
    assert body["status"] == "approved"
    assert body["submitted_by"] == admin["user_id"]
    assert body["household_id"] == admin["household_id"]


def test_family_manual_create_is_pending(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = _post(client, fam_token)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "manual"
    assert body["status"] == "pending"
    assert body["submitted_by"] == member["user_id"]


def test_manual_create_empty_name_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = _post(client, admin["access_token"], _basic_recipe_payload(name=""))
    assert r.status_code == 422


def test_manual_create_bad_ingredient_category_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    payload = _basic_recipe_payload()
    payload["ingredients"][0]["category"] = "garbage"
    r = _post(client, admin["access_token"], payload)
    assert r.status_code == 422


def test_create_without_bearer_returns_401(client):
    r = client.post("/cookbook/recipes", json=_basic_recipe_payload())
    assert r.status_code in (401, 403)


# ---------- Read scope ----------

def test_family_sees_approved_and_own_pending(
    client, sb, created_users, patch_cookbook_agent
):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)

    # Family manual recipe -> pending (only submitter + admin see it).
    fam_manual = _post(client, fam_token, _basic_recipe_payload(name="Fam manual")).json()

    # Family AI recipe -> pending (visible only to submitter + admin).
    patch_cookbook_agent.set(
        name="Fam AI", description="d", ingredients=[
            {"name": "x", "quantity": "1", "unit": "g", "category": "pantry"}
        ],
    )
    fam_ai = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"prompt": "anything", "tag_hints": []},
    ).json()

    # Admin pending recipe (admin's own AI gen).
    patch_cookbook_agent.set(
        name="Admin AI", description="d", ingredients=[
            {"name": "y", "quantity": "1", "unit": "g", "category": "pantry"}
        ],
    )
    admin_ai = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"prompt": "anything", "tag_hints": []},
    ).json()

    # Family GET default: own pending + approved manual; NOT admin's pending.
    fam_list = client.get(
        "/cookbook/recipes",
        headers={"Authorization": f"Bearer {fam_token}"},
    ).json()["recipes"]
    fam_ids = {r["id"] for r in fam_list}
    assert fam_manual["id"] in fam_ids
    assert fam_ai["id"] in fam_ids
    assert admin_ai["id"] not in fam_ids, "Admin's pending should not leak to family"


def test_admin_status_pending_filter_sees_household_queue(
    client, sb, created_users, patch_cookbook_agent
):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)

    patch_cookbook_agent.set(
        name="Fam pending", description=None, ingredients=[],
    )
    client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"prompt": "anything", "tag_hints": []},
    )

    pending = client.get(
        "/cookbook/recipes?status=pending",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    ).json()["recipes"]
    names = [r["name"] for r in pending]
    assert "Fam pending" in names


def test_get_single_cross_household_returns_404(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    rid = _post(client, a1["access_token"]).json()["id"]
    r = client.get(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
    )
    assert r.status_code == 404


def test_get_other_members_pending_returns_404(client, created_users, patch_cookbook_agent):
    admin = _signup_admin(client, created_users)
    m1 = _create_member(client, admin["access_token"], created_users)
    m2 = _create_member(client, admin["access_token"], created_users)
    t1 = _member_token(client, m1)
    t2 = _member_token(client, m2)

    patch_cookbook_agent.set(name="m1 secret", ingredients=[])
    rid = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {t1}"},
        json={"prompt": "anything", "tag_hints": []},
    ).json()["id"]

    r = client.get(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {t2}"},
    )
    assert r.status_code == 404


# ---------- Filtering ----------

def test_filter_by_tag(client, created_users):
    admin = _signup_admin(client, created_users)
    _post(client, admin["access_token"], _basic_recipe_payload(name="A", tags=["high protein"]))
    _post(client, admin["access_token"], _basic_recipe_payload(name="B", tags=["vegetarian"]))
    r = client.get(
        "/cookbook/recipes?tag=high protein",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    names = [x["name"] for x in r.json()["recipes"]]
    assert "A" in names and "B" not in names


def test_filter_by_search(client, created_users):
    admin = _signup_admin(client, created_users)
    _post(client, admin["access_token"], _basic_recipe_payload(name="Chicken Tikka Masala"))
    _post(client, admin["access_token"], _basic_recipe_payload(name="Tomato pasta 2"))
    r = client.get(
        "/cookbook/recipes?search=tikka",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    names = [x["name"] for x in r.json()["recipes"]]
    assert names == ["Chicken Tikka Masala"]


def test_filter_by_source(client, created_users):
    admin = _signup_admin(client, created_users)
    _post(client, admin["access_token"])  # manual
    r = client.get(
        "/cookbook/recipes?source=manual",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert all(x["source"] == "manual" for x in r.json()["recipes"])


# ---------- Patch / Delete ----------

def test_admin_patches_name(client, created_users):
    admin = _signup_admin(client, created_users)
    rid = _post(client, admin["access_token"]).json()["id"]
    r = client.patch(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"name": "Renamed"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"


def test_family_cannot_patch(client, created_users):
    admin = _signup_admin(client, created_users)
    rid = _post(client, admin["access_token"]).json()["id"]
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = client.patch(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"name": "Nope"},
    )
    assert r.status_code == 403


def test_admin_deletes_recipe(client, created_users):
    admin = _signup_admin(client, created_users)
    rid = _post(client, admin["access_token"]).json()["id"]
    r = client.delete(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200


def test_family_cannot_delete(client, created_users):
    admin = _signup_admin(client, created_users)
    rid = _post(client, admin["access_token"]).json()["id"]
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    r = client.delete(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 403


def test_patch_cross_household_returns_404(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    rid = _post(client, a1["access_token"]).json()["id"]
    r = client.patch(
        f"/cookbook/recipes/{rid}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
        json={"name": "X"},
    )
    assert r.status_code == 404


def test_non_uuid_recipe_id_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get(
        "/cookbook/recipes/not-a-uuid",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 422


# ---------- Approve ----------

def test_admin_approves_pending(client, created_users, patch_cookbook_agent):
    admin = _signup_admin(client, created_users)
    patch_cookbook_agent.set(name="Needs approval", ingredients=[])
    rid = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"prompt": "anything", "tag_hints": []},
    ).json()["id"]

    r = client.post(
        f"/cookbook/recipes/{rid}/approve",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


def test_approve_is_idempotent(client, created_users):
    admin = _signup_admin(client, created_users)
    rid = _post(client, admin["access_token"]).json()["id"]
    # Manual is already approved; re-approving should still return 200.
    r = client.post(
        f"/cookbook/recipes/{rid}/approve",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


def test_family_cannot_approve(client, created_users, patch_cookbook_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    patch_cookbook_agent.set(name="Theirs", ingredients=[])
    rid = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"prompt": "x", "tag_hints": []},
    ).json()["id"]

    r = client.post(
        f"/cookbook/recipes/{rid}/approve",
        headers={"Authorization": f"Bearer {fam_token}"},
    )
    assert r.status_code == 403


def test_approve_cross_household_returns_404(client, created_users):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    rid = _post(client, a1["access_token"]).json()["id"]
    r = client.post(
        f"/cookbook/recipes/{rid}/approve",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
    )
    assert r.status_code == 404


# ---------- AI generate ----------

def test_generate_as_family_creates_pending(client, created_users, patch_cookbook_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)
    patch_cookbook_agent.set(
        name="AI pasta", description="d",
        ingredients=[{"name": "x", "quantity": "1", "unit": "g", "category": "pantry"}],
        tags=["quick"], prep_minutes=15, servings=2,
    )
    r = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"prompt": "kid friendly pasta", "tag_hints": ["quick"]},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "ai_generated"
    assert body["status"] == "pending"
    assert body["submitted_by"] == member["user_id"]


def test_generate_as_admin_also_pending(client, created_users, patch_cookbook_agent):
    admin = _signup_admin(client, created_users)
    patch_cookbook_agent.set(name="Admin AI", ingredients=[])
    r = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"prompt": "anything", "tag_hints": []},
    )
    assert r.status_code == 201
    assert r.json()["status"] == "pending"


def test_generate_total_failure_returns_502_no_row(client, sb, created_users, patch_cookbook_agent):
    admin = _signup_admin(client, created_users)
    patch_cookbook_agent.set(name=None, reason="agent rate-limited")
    before = sb.table("recipes").select("id", count="exact").eq("household_id", admin["household_id"]).execute()
    r = client.post(
        "/cookbook/recipes/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"prompt": "anything", "tag_hints": []},
    )
    assert r.status_code == 502
    after = sb.table("recipes").select("id", count="exact").eq("household_id", admin["household_id"]).execute()
    assert (after.count or 0) == (before.count or 0), "502 must not persist a row"


# ---------- AI photo extract ----------

def test_extract_photo_full_success(client, created_users, patch_photo_agent):
    admin = _signup_admin(client, created_users)
    patch_photo_agent.set(
        name="Scanned recipe", description="from a book",
        ingredients=[{"name": "x", "quantity": "1", "unit": "g", "category": "pantry"}],
    )
    r = client.post(
        "/cookbook/recipes/extract-photo",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"image_base64": "abc", "media_type": "image/jpeg"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "photo"
    assert body["status"] == "pending"


def test_extract_photo_partial_annotates_description(client, created_users, patch_photo_agent):
    admin = _signup_admin(client, created_users)
    patch_photo_agent.set(
        name="Partial", description="A short desc",
        ingredients=[{"name": "x", "quantity": "1", "unit": "g", "category": "pantry"}],
        reason="ingredient quantities were unreadable",
    )
    r = client.post(
        "/cookbook/recipes/extract-photo",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"image_base64": "abc", "media_type": "image/jpeg"},
    )
    assert r.status_code == 201
    assert "Extraction note: ingredient quantities were unreadable" in r.json()["description"]


def test_extract_photo_total_failure_returns_502(client, sb, created_users, patch_photo_agent):
    admin = _signup_admin(client, created_users)
    patch_photo_agent.set(name=None, reason="No text detected in image")
    before = sb.table("recipes").select("id", count="exact").eq("household_id", admin["household_id"]).execute()
    r = client.post(
        "/cookbook/recipes/extract-photo",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"image_base64": "abc", "media_type": "image/jpeg"},
    )
    assert r.status_code == 502
    after = sb.table("recipes").select("id", count="exact").eq("household_id", admin["household_id"]).execute()
    assert (after.count or 0) == (before.count or 0)

"""Integration tests for POST /prices/search.

Auth + Supabase reads (low_stock_flags) are real; the price agent + STORE_URLS
are mocked via sys.modules injection so tests don't touch Anthropic.
"""
import sys
import types

import pytest

from tests.test_auth import _create_member, _signup_admin


# --- Helpers --------------------------------------------------------------


def _price(store_url: str, store_name: str, price: float | None) -> dict:
    return {
        "store_url": store_url,
        "store_name": store_name,
        "price": price,
        "currency": "AED",
        "product_url": None,
        "product_name_as_found": None,
        "unit_price": None,
        "unit": None,
    }


def _result(item: str, prices: list[dict]) -> dict:
    non_null = [p["price"] for p in prices if p["price"] is not None]
    cheapest = min(non_null) if non_null else None
    cheap_store = next((p["store_url"] for p in prices if p["price"] == cheapest), None) if cheapest is not None else None
    return {
        "item": item,
        "prices": prices,
        "cheapest_store_url": cheap_store,
        "cheapest_price": cheapest,
        "best_value_store_url": None,
        "best_value_unit_price": None,
        "best_value_unit": None,
    }


def _member_token(client, member: dict) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


@pytest.fixture
def patch_price_agent(monkeypatch):
    """Replace the price agent + STORE_URLS modules with controllable fakes.

    Same pattern as `test_items_scan.py::patch_agent` — inject synthetic
    modules into `sys.modules` so the lazy imports inside `prices.router`
    resolve to our fakes. The fixture also forces the router's env-var check
    to pick the real (non-dummy) module via `monkeypatch.delenv`, so the
    handler always imports `price_agent` (which we control here).
    """
    calls: list[tuple[list[str], list[str]]] = []
    result_holder: dict = {"results": []}

    def fake_search(items: list[str], stores: list[str]) -> list[dict]:
        calls.append((list(items), list(stores)))
        return result_holder["results"]

    fake_agent = types.ModuleType("price_agent")
    fake_agent.search_grocery_prices = fake_search
    monkeypatch.setitem(sys.modules, "price_agent", fake_agent)

    fake_config = types.ModuleType("price_config")
    fake_config.STORE_URLS = [
        "https://www.spinneys.com/en-ae/",
        "https://www.carrefouruae.com",
    ]
    monkeypatch.setitem(sys.modules, "price_config", fake_config)

    # Ensure we always go through the real-agent branch in the router.
    monkeypatch.delenv("PRICE_AGENT_DUMMY", raising=False)

    def set_results(results: list[dict]):
        result_holder["results"] = results

    return type("PatchHandle", (), {"set": staticmethod(set_results), "calls": calls})


# --- Happy paths ----------------------------------------------------------


def test_admin_happy_path_returns_results(client, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    patch_price_agent.set([
        _result("milk 2L", [
            _price("https://www.spinneys.com/en-ae/", "Spinneys", 8.50),
            _price("https://www.carrefouruae.com", "Carrefour UAE", 7.25),
        ]),
    ])

    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["milk 2L"], "use_low_stock": False},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["results"]) == 1
    entry = body["results"][0]
    assert entry["item"] == "milk 2L"
    assert entry["cheapest_price"] == 7.25
    assert entry["cheapest_store_url"] == "https://www.carrefouruae.com"
    assert len(entry["prices"]) == 2

    # Agent was called with the FE-supplied items and our fake STORE_URLS.
    assert len(patch_price_agent.calls) == 1
    items_called, stores_called = patch_price_agent.calls[0]
    assert items_called == ["milk 2L"]
    assert stores_called == [
        "https://www.spinneys.com/en-ae/",
        "https://www.carrefouruae.com",
    ]


def test_use_low_stock_merges_flag_names_into_items(client, sb, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    # Flag two items as low-stock for this household.
    for name in ("Bread", "Eggs"):
        flag = client.post(
            "/low-stock",
            headers={"Authorization": f"Bearer {admin['access_token']}"},
            json={"name": name},
        )
        assert flag.status_code == 201, flag.text

    patch_price_agent.set([
        _result("milk", [_price("https://www.spinneys.com/en-ae/", "Spinneys", 5.0)]),
        _result("Bread", [_price("https://www.spinneys.com/en-ae/", "Spinneys", 3.0)]),
        _result("Eggs", [_price("https://www.spinneys.com/en-ae/", "Spinneys", 12.0)]),
    ])

    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["milk"], "use_low_stock": True},
    )
    assert r.status_code == 200, r.text

    # Agent received the merged list — explicit item first, low-stock names appended.
    items_called, _ = patch_price_agent.calls[0]
    assert items_called[0] == "milk"
    assert set(items_called) == {"milk", "Bread", "Eggs"}


# --- Failure modes --------------------------------------------------------


def test_empty_body_returns_422_at_schema_layer(client, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": [], "use_low_stock": False},
    )
    assert r.status_code == 422, r.text


def test_use_low_stock_with_no_flags_and_no_items_returns_422(client, created_users, patch_price_agent):
    """Schema allows {items: [], use_low_stock: true}; handler 422s if both
    sources produce zero items (the merged list ends up empty)."""
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": [], "use_low_stock": True},
    )
    assert r.status_code == 422, r.text
    assert "low-stock" in r.json()["detail"].lower() or "items" in r.json()["detail"].lower()


def test_whitespace_only_item_rejected(client, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["   "], "use_low_stock": False},
    )
    assert r.status_code == 422, r.text


def test_extra_field_rejected(client, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["milk"], "use_low_stock": False, "ghost": True},
    )
    assert r.status_code == 422, r.text
    assert "ghost" in r.text


def test_total_agent_failure_returns_502(client, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    patch_price_agent.set([
        _result("milk", [_price("https://www.spinneys.com/en-ae/", "Spinneys", None)]),
        _result("bread", [_price("https://www.spinneys.com/en-ae/", "Spinneys", None)]),
    ])

    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["milk", "bread"], "use_low_stock": False},
    )
    assert r.status_code == 502, r.text


def test_partial_agent_failure_returns_200(client, created_users, patch_price_agent):
    """If at least one price is non-null anywhere, the response is 200 — only
    a total failure (all nulls) raises 502."""
    admin = _signup_admin(client, created_users)
    patch_price_agent.set([
        _result("milk", [_price("https://www.spinneys.com/en-ae/", "Spinneys", 5.0)]),
        _result("bread", [_price("https://www.spinneys.com/en-ae/", "Spinneys", None)]),
    ])

    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["milk", "bread"], "use_low_stock": False},
    )
    assert r.status_code == 200, r.text


# --- Auth -----------------------------------------------------------------


def test_family_returns_403(client, created_users, patch_price_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_token = _member_token(client, member)

    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {fam_token}"},
        json={"items": ["milk"], "use_low_stock": False},
    )
    assert r.status_code == 403, r.text


def test_missing_bearer_returns_401_or_403(client, patch_price_agent):
    r = client.post(
        "/prices/search",
        json={"items": ["milk"], "use_low_stock": False},
    )
    assert r.status_code in (401, 403)


# --- 503 when price-agent module isn't packaged ---------------------------


def test_missing_price_agent_module_returns_503(client, created_users, monkeypatch):
    """If neither price_agent nor price_agent_dummy can be imported, the
    handler returns 503 instead of 500. Don't install the fakes for this one
    and force a clean ImportError by removing any cached modules."""
    admin = _signup_admin(client, created_users)
    monkeypatch.delenv("PRICE_AGENT_DUMMY", raising=False)
    for mod in ("price_agent", "price_agent_dummy", "price_config"):
        monkeypatch.delitem(sys.modules, mod, raising=False)
    # Also block re-import by temporarily removing the price-agent folder
    # from sys.path. (We don't restore — monkeypatch handles teardown.)
    monkeypatch.setattr(sys, "path", [p for p in sys.path if "price-agent" not in p])

    r = client.post(
        "/prices/search",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"items": ["milk"], "use_low_stock": False},
    )
    assert r.status_code == 503, r.text

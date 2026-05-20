"""Integration test fixtures. Hit a real Supabase project — never mocks.

Tests are skipped (with a clear reason) if TEST_SUPABASE_* env vars are unset.
See backend/.env.example for the full list.
"""
import os
import secrets
import time
import uuid

import pytest

REQUIRED_ENV = [
    "TEST_SUPABASE_URL",
    "TEST_SUPABASE_SERVICE_ROLE_KEY",
    "TEST_SUPABASE_ANON_KEY",
    "TEST_SUPABASE_JWKS_URL",
    "TEST_SUPABASE_JWT_ISSUER",
]

_missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
if _missing:
    pytest.skip(
        f"Supabase test project not configured. Missing env: {', '.join(_missing)}. "
        "Set TEST_SUPABASE_* in backend/.env to run integration tests against a real project.",
        allow_module_level=True,
    )

# Promote TEST_* into the SUPABASE_* names the app expects, BEFORE importing
# the FastAPI app (settings is loaded at import time).
os.environ["SUPABASE_URL"] = os.environ["TEST_SUPABASE_URL"]
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.environ["TEST_SUPABASE_SERVICE_ROLE_KEY"]
os.environ["SUPABASE_ANON_KEY"] = os.environ["TEST_SUPABASE_ANON_KEY"]
os.environ["SUPABASE_JWKS_URL"] = os.environ["TEST_SUPABASE_JWKS_URL"]
os.environ["SUPABASE_JWT_ISSUER"] = os.environ["TEST_SUPABASE_JWT_ISSUER"]
os.environ["SUPABASE_JWT_AUDIENCE"] = os.environ.get("TEST_SUPABASE_JWT_AUDIENCE", "authenticated")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.supabase_client import get_supabase  # noqa: E402


def unique_email() -> str:
    return f"test+{uuid.uuid4().hex[:12]}@housewise.test"


def strong_password() -> str:
    return secrets.token_urlsafe(16) + "Aa1!"


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def sb():
    return get_supabase()


@pytest.fixture()
def created_users():
    """Track auth.users IDs created during a test and clean them up after.

    Cascades through public.users + households (FK ON DELETE).
    """
    ids: list[str] = []
    yield ids
    sb = get_supabase()
    for uid in ids:
        try:
            sb.auth.admin.delete_user(uid)
        except Exception:
            pass


def wait_for(predicate, *, timeout: float = 5.0, interval: float = 0.1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(interval)
    return predicate()

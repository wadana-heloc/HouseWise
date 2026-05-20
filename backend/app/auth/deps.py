import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import JWTError

from ..settings import settings

_bearer_scheme = HTTPBearer(auto_error=True)


@dataclass
class CurrentUser:
    id: str
    email: str | None
    role: str | None
    raw_claims: dict[str, Any]


_JWKS_CACHE: dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 600


async def _fetch_jwks() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get(settings.SUPABASE_JWKS_URL)
        r.raise_for_status()
        return r.json()


async def _get_jwks(force_refresh: bool = False) -> dict[str, Any]:
    now = time.time()
    stale = _JWKS_CACHE["keys"] is None or now - _JWKS_CACHE["fetched_at"] > _JWKS_TTL_SECONDS
    if force_refresh or stale:
        _JWKS_CACHE["keys"] = await _fetch_jwks()
        _JWKS_CACHE["fetched_at"] = now
    return _JWKS_CACHE["keys"]


def _decode(token: str, jwks: dict[str, Any]) -> dict[str, Any]:
    return jwt.decode(
        token,
        jwks,
        algorithms=["ES256"],
        audience=settings.SUPABASE_JWT_AUDIENCE,
        issuer=settings.SUPABASE_JWT_ISSUER,
    )


async def current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> CurrentUser:
    token = creds.credentials
    jwks = await _get_jwks()
    try:
        claims = _decode(token, jwks)
    except JWTError:
        # Could be a key rotation. Refresh JWKS once and retry.
        jwks = await _get_jwks(force_refresh=True)
        try:
            claims = _decode(token, jwks)
        except JWTError as e:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")

    # Role lives in app_metadata. user_metadata is user-writable; trusting it
    # would be a privilege escalation bug.
    app_meta = claims.get("app_metadata") or {}
    role = app_meta.get("role")

    return CurrentUser(
        id=claims["sub"],
        email=claims.get("email"),
        role=role,
        raw_claims=claims,
    )


def require_role(*allowed: str):
    async def _dep(u: CurrentUser = Depends(current_user)) -> CurrentUser:
        if u.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return u
    return _dep


def bearer_token(
    creds: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> str:
    return creds.credentials

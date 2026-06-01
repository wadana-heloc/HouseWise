import sys
from contextlib import asynccontextmanager
from pathlib import Path

# The image-analysis agent lives in `ai_agents/image-agent/`. Python can't
# import through that folder name directly because the hyphen is a syntax
# error (parsed as subtraction). We add the folder itself to sys.path so the
# `image_agent.py` file inside resolves as a top-level module. Drop this
# block if the AI team ever renames the folder to `image_agent` (underscore).
_AGENT_DIR = Path(__file__).resolve().parents[2] / "ai_agents" / "image-agent"
if _AGENT_DIR.is_dir() and str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

from fastapi import FastAPI

from .auth.router import router as auth_router
from .household.router import router as household_router
from .items.router import router as items_router
from .logging_setup import configure_logging
from .low_stock.router import router as low_stock_router
from .me.router import router as me_router
from .stores.router import router as stores_router

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # EasyOCR loads its ~50 MB English model the first time the agent module
    # is imported. Warm it during startup so the first /items/scan-image
    # request doesn't pay the 10-30s cold-start.
    import logging
    log = logging.getLogger("housewise.scan")
    try:
        import image_agent  # noqa: F401
        log.info("image_agent warmed (EasyOCR model loaded)")
    except Exception as e:
        # The scan endpoint will return its own 503 from the per-request
        # import path. The rest of the API must still boot — but we want
        # the reason visible in startup logs, not silently swallowed.
        log.warning("image_agent unavailable at startup: %s: %s", type(e).__name__, e)
    yield


app = FastAPI(
    title="HouseWise Backend",
    version="0.1.0",
    description=(
        "HouseWise API. Admins self-sign-up, create family members directly with "
        "credentials, and manage member passwords/accounts. Members log in with "
        "those credentials and can change their own password. The only "
        "email-link flow is admin password recovery.\n\n"
        "All authenticated endpoints expect `Authorization: Bearer <access_token>`."
    ),
    lifespan=lifespan,
)
app.include_router(auth_router)
app.include_router(household_router)
app.include_router(items_router)
app.include_router(low_stock_router)
app.include_router(me_router)
app.include_router(stores_router)


@app.get("/health", tags=["meta"], summary="Liveness probe")
def health():
    """Returns `{ok: true}` if the process is up. No auth, no DB access."""
    return {"ok": True}

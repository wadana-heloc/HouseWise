import sys
from contextlib import asynccontextmanager
from pathlib import Path

# AI agents live in hyphenated folders under `ai_agents/`. Python can't
# import through those folder names directly (hyphen is parsed as subtraction).
# We add each folder to sys.path so the underscored `*_agent.py` files inside
# resolve as top-level modules. Drop a folder from this list once the AI team
# repackages it with an underscored folder name.
for _folder in ("image-agent", "cookbook-agent", "recipe-photo-agent", "meal-plan-agent", "price-agent"):
    _p = Path(__file__).resolve().parents[2] / "ai_agents" / _folder
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .auth.router import router as auth_router
from .cookbook.router import router as cookbook_router
from .household.router import report_router as household_report_router
from .household.router import router as household_router
from .items.router import router as items_router
from .logging_setup import configure_logging
from .low_stock.router import router as low_stock_router
from .me.router import router as me_router
from .meal_plan.router import router as meal_plan_router
from .prices.router import router as prices_router
from .stores.router import router as stores_router
from .to_buy.router import router as to_buy_router

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
# Reject JSON bodies nested deeper than this. Python's default recursion
# limit (~1000) trips inside stdlib json/Pydantic on deeply nested input,
# escaping as a 500. Real payloads in this API top out around depth 3, so
# 32 is generous while staying well under the recursion ceiling.
MAX_JSON_DEPTH = 32


def _exceeds_json_depth(raw: bytes, limit: int) -> bool:
    depth = 0
    in_string = False
    escape = False
    for b in raw:
        if escape:
            escape = False
            continue
        if in_string:
            if b == 0x5C:    # backslash
                escape = True
            elif b == 0x22:  # "
                in_string = False
            continue
        if b == 0x22:
            in_string = True
        elif b == 0x7B or b == 0x5B:  # { [
            depth += 1
            if depth > limit:
                return True
        elif b == 0x7D or b == 0x5D:  # } ]
            depth -= 1
    return False


@app.middleware("http")
async def json_depth_limit(request: Request, call_next):
    if "application/json" in request.headers.get("content-type", "").lower():
        body = await request.body()
        if body and _exceeds_json_depth(body, MAX_JSON_DEPTH):
            return JSONResponse(
                {"detail": f"JSON nesting exceeds maximum depth of {MAX_JSON_DEPTH}"},
                status_code=422,
            )
        # ASGI receive is single-shot — replay the cached body for downstream.
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request._receive = receive
    return await call_next(request)


app.include_router(auth_router)
app.include_router(cookbook_router)
app.include_router(household_router)
app.include_router(household_report_router)
app.include_router(items_router)
app.include_router(low_stock_router)
app.include_router(me_router)
app.include_router(meal_plan_router)
app.include_router(prices_router)
app.include_router(stores_router)
app.include_router(to_buy_router)


@app.get("/health", tags=["meta"], summary="Liveness probe")
def health():
    """Returns `{ok: true}` if the process is up. No auth, no DB access."""
    return {"ok": True}

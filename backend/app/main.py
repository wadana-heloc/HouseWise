from fastapi import FastAPI

from .auth.router import router as auth_router
from .household.router import router as household_router
from .items.router import router as items_router
from .logging_setup import configure_logging
from .me.router import router as me_router

configure_logging()

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
)
app.include_router(auth_router)
app.include_router(household_router)
app.include_router(items_router)
app.include_router(me_router)


@app.get("/health", tags=["meta"], summary="Liveness probe")
def health():
    """Returns `{ok: true}` if the process is up. No auth, no DB access."""
    return {"ok": True}

from fastapi import APIRouter, Depends, HTTPException, status

from ..settings import settings
from ..supabase_client import get_anon_supabase, get_supabase
from .deps import CurrentUser, bearer_token, current_user
from .schemas import (
    LoginRequest,
    OkResponse,
    PasswordResetRequest,
    PasswordUpdateRequest,
    Session,
    SignupRequest,
    SignupResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/signup",
    response_model=SignupResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Admin signup (creates household + auto-login)",
)
def signup(body: SignupRequest):
    """Create the first admin of a new household and return a usable session.

    Side effects:
    - Creates an `auth.users` row with `email_confirm=true` (no confirmation email).
    - Creates a `public.households` row with this user as `admin_id`.
    - Sets `public.users.role='admin'`, `household_id`, `display_name`, `email`.
    - Immediately calls `sign_in_with_password` on a fresh anon client and
      returns the resulting session.

    The mobile client should store `session.access_token` and
    `session.refresh_token` in SecureStore and attach the access token as
    `Authorization: Bearer ...` on subsequent requests.

    Errors: 409 if the email is already registered. 422 on other validation
    failures from Supabase. 500 if the household insert or the auto-login fails
    after the user was already created (the user exists; mobile can fall back
    to `POST /auth/login`).
    """
    sb = get_supabase()

    # 1. Create the auth.users row. email_confirm=True -> immediate access,
    # no confirmation step. Role lands in JWT via app_metadata.
    try:
        created = sb.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            "email_confirm": True,
            "app_metadata": {"role": "admin"},
            "user_metadata": {"display_name": body.display_name},
        })
    except Exception as e:
        msg = str(e).lower()
        if "already" in msg or "registered" in msg or "exists" in msg:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Signup failed: {e}")

    user_id = created.user.id

    # 2. Create the household.
    hh_res = (
        sb.table("households")
        .insert({"name": body.household_name, "admin_id": user_id})
        .execute()
    )
    if not hh_res.data:
        sb.auth.admin.delete_user(user_id)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Failed to create household")
    household_id = hh_res.data[0]["id"]

    # 3. Set household_id, role, display_name on the public.users row.
    sb.table("users").update({
        "household_id": household_id,
        "role": "admin",
        "display_name": body.display_name,
        "email": body.email,
    }).eq("id", user_id).execute()

    confirm = sb.table("users").select("id, household_id, role").eq("id", user_id).single().execute()
    if not confirm.data or confirm.data.get("household_id") != household_id or confirm.data.get("role") != "admin":
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "User profile write did not land")

    # 4. Auto-login on a fresh anon client. Never use the service_role client
    # for sign_in_with_password — it attaches the session to that client.
    anon = get_anon_supabase()
    try:
        res = anon.auth.sign_in_with_password({"email": body.email, "password": body.password})
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Signup succeeded but auto-login failed; call /auth/login: {e}",
        )
    if not res.session:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Signup succeeded but auto-login returned no session; call /auth/login",
        )

    s = res.session
    user_payload = res.user.model_dump() if hasattr(res.user, "model_dump") else dict(res.user)
    session = Session(
        access_token=s.access_token,
        refresh_token=s.refresh_token,
        expires_in=s.expires_in,
        user=user_payload,
    )

    return SignupResponse(user_id=user_id, household_id=household_id, session=session)


@router.post("/login", response_model=Session, summary="Email + password login")
def login(body: LoginRequest):
    """Exchange `email` + `password` for a Supabase session.

    Used by both admins and members. There is no email-confirmation gating —
    all accounts are created with `email_confirm=true`.

    Returns `access_token`, `refresh_token`, `expires_in`, and the Supabase
    `user` payload. Mobile must store both tokens in SecureStore. The Supabase
    JS SDK is the canonical refresh mechanism; this backend does not expose
    a `/auth/refresh` endpoint.

    Errors: 401 on invalid credentials.
    """
    # Use a fresh anon client. Calling sign_in_with_password on the shared
    # service_role client attaches the user's session to it, causing later
    # PostgREST calls to go through RLS as that user.
    sb = get_anon_supabase()
    try:
        res = sb.auth.sign_in_with_password({"email": body.email, "password": body.password})
    except Exception as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid credentials: {e}")

    if not res.session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login failed")

    s = res.session
    user_payload = res.user.model_dump() if hasattr(res.user, "model_dump") else dict(res.user)
    return Session(
        access_token=s.access_token,
        refresh_token=s.refresh_token,
        expires_in=s.expires_in,
        user=user_payload,
    )


@router.post("/logout", response_model=OkResponse, summary="Sign out the current device")
def logout(token: str = Depends(bearer_token), _: CurrentUser = Depends(current_user)):
    """Revoke the refresh token tied to this access token (`scope=local`).

    Other devices' sessions are unaffected. The current access token remains
    valid until its natural `exp` (~1h) — Supabase JWTs are stateless. After
    calling this, the mobile client should also call `supabase.auth.signOut()`
    locally to clear SecureStore.
    """
    # admin.sign_out takes the JWT, NOT the user_id.
    get_supabase().auth.admin.sign_out(token, scope="local")
    return OkResponse()


@router.post("/logout-all", response_model=OkResponse, summary="Sign out every device")
def logout_all(token: str = Depends(bearer_token), _: CurrentUser = Depends(current_user)):
    """Revoke every refresh token for the current user (`scope=global`).

    All other devices stop being able to refresh. Existing access tokens
    remain valid until their natural `exp`.
    """
    get_supabase().auth.admin.sign_out(token, scope="global")
    return OkResponse()


@router.post(
    "/password-reset",
    response_model=OkResponse,
    summary="Send a password-reset email (admins only)",
)
def password_reset(body: PasswordResetRequest):
    """Email a recovery link to an admin who forgot their password.

    This is the only remaining email-link flow. The backend looks up the
    email in `public.users`; if and only if the role is `admin`, it asks
    Supabase to send the reset email with `redirect_to=APP_DEEP_LINK`.

    Members do **not** have an email recovery path. If a member forgets
    their password, the household admin resets it via
    `POST /household/members/{member_id}/password`.

    Always returns 200 regardless of whether the email exists or what role
    it has — this prevents email enumeration.
    """
    sb = get_supabase()
    row = sb.table("users").select("role").eq("email", body.email).maybe_single().execute()
    if row and row.data and row.data.get("role") == "admin":
        try:
            sb.auth.reset_password_email(
                body.email,
                options={"redirect_to": settings.APP_DEEP_LINK},
            )
        except Exception:
            pass
    return OkResponse()


@router.post(
    "/password-update",
    response_model=OkResponse,
    summary="Change the bearer's password (self-update)",
)
def password_update(body: PasswordUpdateRequest, user: CurrentUser = Depends(current_user)):
    """Set a new password for whichever account owns the bearer token.

    Works for two flows:
    - **Recovery link**: an admin who came back via the password-reset email
      arrives with a recovery session — pass that access token as the bearer.
    - **Logged-in user**: any admin or member can rotate their own password
      while logged in.

    Does not log the user out; existing sessions stay alive. Requires
    `Authorization: Bearer <access_token>`.
    """
    get_supabase().auth.admin.update_user_by_id(user.id, {"password": body.new_password})
    return OkResponse()

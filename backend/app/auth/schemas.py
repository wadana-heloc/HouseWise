from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from .password_policy import MAX_LENGTH, validate_password

Password = Annotated[str, Field(max_length=MAX_LENGTH), AfterValidator(validate_password)]


class SignupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    household_name: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: Password


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Plain str (not EmailStr) on purpose: EmailStr 422s on RFC-6761 reserved
    # TLDs (`.test`, `.example`, `.invalid`, `.localhost`) and a few other
    # shapes before login runs, which leaked an enumeration signal (BUG-008
    # second half). Letting any string of reasonable length through means
    # Supabase becomes the single arbiter — bad credentials always return
    # 401, no path-dependent 422. Other endpoints keep EmailStr because they
    # create accounts and need real syntactic validation.
    email: str = Field(max_length=254)
    password: str


class Session(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"
    user: dict[str, Any]


class SignupResponse(BaseModel):
    user_id: str
    household_id: str
    session: Session


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr


class PasswordUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_password: Password


class OkResponse(BaseModel):
    ok: bool = True

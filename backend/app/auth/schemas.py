from typing import Any

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    household_name: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
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
    email: EmailStr


class PasswordUpdateRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)


class OkResponse(BaseModel):
    ok: bool = True

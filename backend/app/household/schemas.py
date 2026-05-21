from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from ..auth.schemas import Password


class CreateMemberRequest(BaseModel):
    email: EmailStr
    password: Password
    display_name: str = Field(min_length=1, max_length=80)


class CreateMemberResponse(BaseModel):
    user_id: str
    email: EmailStr
    display_name: str
    role: Literal["family"] = "family"


class AdminResetMemberPasswordRequest(BaseModel):
    new_password: Password


class MemberRow(BaseModel):
    id: str
    email: EmailStr
    display_name: str
    role: Literal["admin", "family"]


class MemberListResponse(BaseModel):
    members: list[MemberRow]

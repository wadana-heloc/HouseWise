from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class CreateMemberRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=80)


class CreateMemberResponse(BaseModel):
    user_id: str
    email: EmailStr
    display_name: str
    role: Literal["family"] = "family"


class AdminResetMemberPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)


class MemberRow(BaseModel):
    id: str
    email: EmailStr
    display_name: str
    role: Literal["admin", "family"]

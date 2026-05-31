from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, model_validator

from ..auth.schemas import Password


class CreateMemberRequest(BaseModel):
    email: EmailStr
    password: Password
    display_name: str = Field(min_length=1, max_length=80)


class UpdateMemberRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    email: Optional[EmailStr] = None

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self


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

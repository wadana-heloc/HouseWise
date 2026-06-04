from typing import Annotated, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from ..auth.schemas import Password


# ISO weekday: 1=Mon..7=Sun. Matches `meal_plan_submissions.busy_days`.
# FE displays Sunday-first (US convention); that's a display-side mapping.
ReportDay = Annotated[int, Field(ge=1, le=7)]

# "HH:MM" 24h. Same regex enforced at the DB level in migration 0013.
ReportTime = Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]


def _validate_iana_timezone(v: str) -> str:
    try:
        ZoneInfo(v)
    except ZoneInfoNotFoundError as e:
        raise ValueError(f"Unknown IANA timezone: {v!r}") from e
    return v


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


class ReportSettings(BaseModel):
    """Household weekly-report schedule. All three fields are always present —
    backed by NOT NULL columns with sane defaults on `public.households`.
    """

    report_day: ReportDay
    report_time: ReportTime
    report_timezone: str = Field(min_length=1, max_length=64)


class ReportSettingsUpdate(BaseModel):
    report_day: Optional[ReportDay] = None
    report_time: Optional[ReportTime] = None
    report_timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("report_timezone")
    @classmethod
    def _tz_is_iana(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_iana_timezone(v)

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self

from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


HEALTH_PREF_KEYS: tuple[str, ...] = (
    "high_protein",
    "low_calories",
    "low_carbs",
    "low_sugar",
    "whole_grain",
)


class HealthPreferences(BaseModel):
    high_protein: bool = False
    low_calories: bool = False
    low_carbs: bool = False
    low_sugar: bool = False
    whole_grain: bool = False

    model_config = ConfigDict(extra="forbid")


class HealthPreferencesUpdate(BaseModel):
    high_protein: Optional[bool] = None
    low_calories: Optional[bool] = None
    low_carbs: Optional[bool] = None
    low_sugar: Optional[bool] = None
    whole_grain: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one health preference")
        return self


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    email: Optional[EmailStr] = None

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self


class MeUser(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    household_id: str | None
    health_preferences: HealthPreferences


class MeHousehold(BaseModel):
    id: str
    name: str
    admin_id: str


class MeResponse(BaseModel):
    user: MeUser
    household: MeHousehold | None

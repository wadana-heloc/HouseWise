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


# Dietary preferences are FE-driven free-text lists. The FE owns the
# dietary_types vocabulary (chip set: vegetarian / vegan / halal / keto /
# gluten-free / dairy-free / paleo / nut-free at time of writing).
# Backend doesn't validate against an enum so the FE can add chips without
# a backend deploy. Allergies and dislikes are pure free-text by design.
class DietaryPreferences(BaseModel):
    dietary_types: list[str] = Field(default_factory=list, max_length=20)
    allergies: list[str] = Field(default_factory=list, max_length=50)
    dislikes: list[str] = Field(default_factory=list, max_length=50)


class DietaryPreferencesUpdate(BaseModel):
    dietary_types: Optional[list[str]] = Field(default=None, max_length=20)
    allergies: Optional[list[str]] = Field(default=None, max_length=50)
    dislikes: Optional[list[str]] = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
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
    dietary_preferences: DietaryPreferences


class MeHousehold(BaseModel):
    id: str
    name: str
    admin_id: str


class MeResponse(BaseModel):
    user: MeUser
    household: MeHousehold | None

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from ..items.schemas import ItemCategory

PrepLabel = Literal["prep", "reheat", "fresh"]
MealPlanStatus = Literal["draft", "finalized"]


class MealRequest(BaseModel):
    description: str = Field(min_length=1, max_length=300)
    recipe_id: Optional[str] = None


class SubmissionUpsert(BaseModel):
    week_start: date
    busy_days: list[int] = Field(default_factory=list, max_length=7)
    meal_requests: list[MealRequest] = Field(default_factory=list, max_length=20)
    week_notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("busy_days")
    @classmethod
    def _busy_days_valid(cls, v: list[int]) -> list[int]:
        for d in v:
            if d < 1 or d > 7:
                raise ValueError("busy_days entries must be in 1..7 (1=Mon, 7=Sun)")
        if len(set(v)) != len(v):
            raise ValueError("busy_days must not contain duplicates")
        return v


class SubmissionOut(BaseModel):
    id: str
    household_id: str
    user_id: str
    week_start: date
    busy_days: list[int]
    meal_requests: list[MealRequest]
    week_notes: Optional[str]
    submitted_at: datetime


class MemberSubmissionStatus(BaseModel):
    user_id: str
    display_name: str
    submitted: bool


class SubmissionStatusList(BaseModel):
    week_start: date
    submitted: int
    total: int
    members: list[MemberSubmissionStatus]


class SuggestedIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: str = Field(min_length=1, max_length=40)
    unit: str = Field(min_length=1, max_length=40)
    category: ItemCategory


class MealPlanDayOut(BaseModel):
    id: str
    plan_id: str
    day_of_week: int
    recipe_id: Optional[str]
    meal_name: str
    prep_label: PrepLabel
    notes: Optional[str]
    suggested_ingredients: list[SuggestedIngredient]


class MealPlanOut(BaseModel):
    id: str
    household_id: str
    week_start: date
    status: MealPlanStatus
    ai_summary: Optional[str]
    created_by: str
    created_at: datetime
    updated_at: datetime
    days: list[MealPlanDayOut]


class GenerateMealPlanRequest(BaseModel):
    week_start: date


class DayUpdate(BaseModel):
    meal_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    prep_label: Optional[PrepLabel] = None
    notes: Optional[str] = Field(default=None, max_length=1000)
    recipe_id: Optional[str] = None

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self

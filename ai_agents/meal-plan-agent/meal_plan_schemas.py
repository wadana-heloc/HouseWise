# meal_plan_schemas.py
#
# Pydantic models for the Meal Plan agent.
# Defines the shape of the 7-day dinner plan that generate_weekly_plan() produces.

from pydantic import BaseModel
from typing import Optional


class SuggestedIngredient(BaseModel):
    name: str
    quantity: str
    unit: str
    category: str


class MealPlanDay(BaseModel):
    day_of_week: int
    recipe_id: Optional[str] = None
    meal_name: str
    prep_label: str                              # 'prep' | 'reheat' | 'fresh'
    notes: Optional[str] = None
    suggested_ingredients: list[SuggestedIngredient] = []


class WeeklyPlanResult(BaseModel):
    ai_summary: Optional[str] = None
    days: list[MealPlanDay] = []
    reason: Optional[str] = None                 # null on success, error string on failure

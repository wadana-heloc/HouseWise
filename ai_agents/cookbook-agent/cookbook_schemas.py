# cookbook_schemas.py
#
# Pydantic models for the Cookbook agent.
# Defines the shape of recipe data that generate_recipe() and
# personalize_recipe_description() produce and validate against.

from pydantic import BaseModel
from typing import Optional


class RecipeIngredient(BaseModel):
    name: str
    quantity: str
    unit: str
    category: str


class GeneratedRecipe(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    ingredients: list[RecipeIngredient] = []
    instructions: Optional[str] = None
    tags: list[str] = []
    prep_minutes: Optional[int] = None
    servings: Optional[int] = None
    reason: Optional[str] = None

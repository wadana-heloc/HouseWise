# recipe_photo_schemas.py
#
# Pydantic models for the Recipe Photo agent.
# RecipePhotoResult shares the same shape as GeneratedRecipe in the cookbook agent
# so the backend can handle both with identical downstream logic.

from pydantic import BaseModel
from typing import Optional


class RecipePhotoIngredient(BaseModel):
    name: str
    quantity: str
    unit: str
    category: str


class RecipePhotoResult(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    ingredients: list[RecipePhotoIngredient] = []
    instructions: Optional[str] = None
    tags: list[str] = []
    prep_minutes: Optional[int] = None
    servings: Optional[int] = None
    reason: Optional[str] = None

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from ..items.schemas import SCAN_IMAGE_MAX_BASE64, ItemCategory

RecipeSource = Literal["manual", "ai_generated", "photo"]
RecipeStatus = Literal["pending", "approved"]


class RecipeIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: str = Field(min_length=1, max_length=40)
    unit: str = Field(min_length=1, max_length=40)
    category: ItemCategory


class RecipeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    ingredients: list[RecipeIngredient] = Field(default_factory=list)
    instructions: Optional[str] = Field(default=None, max_length=10_000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    prep_minutes: Optional[int] = Field(default=None, gt=0)
    servings: Optional[int] = Field(default=None, gt=0)


class RecipeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    ingredients: Optional[list[RecipeIngredient]] = None
    instructions: Optional[str] = Field(default=None, max_length=10_000)
    tags: Optional[list[str]] = Field(default=None, max_length=20)
    prep_minutes: Optional[int] = Field(default=None, gt=0)
    servings: Optional[int] = Field(default=None, gt=0)
    status: Optional[RecipeStatus] = None

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self


class RecipeOut(BaseModel):
    id: str
    household_id: str
    name: str
    description: Optional[str]
    ingredients: list[RecipeIngredient]
    instructions: Optional[str]
    tags: list[str]
    prep_minutes: Optional[int]
    servings: Optional[int]
    source: RecipeSource
    status: RecipeStatus
    submitted_by: Optional[str]
    created_at: datetime
    updated_at: datetime


class RecipeList(BaseModel):
    recipes: list[RecipeOut]


class GenerateRecipeRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=500)
    tag_hints: list[str] = Field(default_factory=list, max_length=10)


class ExtractPhotoRequest(BaseModel):
    image_base64: str = Field(min_length=1, max_length=SCAN_IMAGE_MAX_BASE64)
    media_type: Literal["image/jpeg", "image/png", "image/webp"]

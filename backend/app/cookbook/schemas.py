from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..items.schemas import SCAN_IMAGE_MAX_BASE64, ItemCategory

RecipeSource = Literal["manual", "ai_generated", "photo"]
RecipeStatus = Literal["pending", "approved"]


class RecipeIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: str = Field(min_length=1, max_length=40)
    unit: str = Field(min_length=1, max_length=40)
    category: ItemCategory


class RecipeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    story: Optional[str] = Field(default=None, min_length=1, max_length=5000)
    ingredients: list[RecipeIngredient] = Field(default_factory=list)
    instructions: Optional[str] = Field(default=None, max_length=10_000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    prep_minutes: Optional[int] = Field(default=None, gt=0)
    servings: Optional[int] = Field(default=None, gt=0)
    # FE passes 'ai_generated' / 'photo' when saving a preview from
    # /recipes/generate or /recipes/extract-photo; defaults to manual.
    source: RecipeSource = "manual"


class RecipeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    story: Optional[str] = Field(default=None, min_length=1, max_length=5000)
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
    story: Optional[str]
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
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=5, max_length=500)
    tag_hints: list[str] = Field(default_factory=list, max_length=10)


class ExtractPhotoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(min_length=1, max_length=SCAN_IMAGE_MAX_BASE64)
    media_type: Literal["image/jpeg", "image/png", "image/webp"]


class PersonalizedDescription(BaseModel):
    """Per-user, AI-generated description of a recipe. Cached in
    `recipe_personalized_descriptions`; regenerated when the recipe's
    `updated_at` advances past the cache row's `generated_at`. Empty string
    means the agent couldn't produce one — FE renders the recipe without
    the blurb in that case.
    """

    description: str
    generated_at: datetime


class RecipePreview(BaseModel):
    """AI-generated / photo-extracted recipe data — NOT yet persisted.

    Returned by /cookbook/recipes/generate and /cookbook/recipes/extract-photo.
    The FE shows this on a review screen; the user edits and then calls
    POST /cookbook/recipes with `source` set to persist a single row. If the
    user cancels the screen, nothing is written to the DB.
    """

    name: str
    description: Optional[str] = None
    ingredients: list[RecipeIngredient] = Field(default_factory=list)
    instructions: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    prep_minutes: Optional[int] = None
    servings: Optional[int] = None
    source: RecipeSource
    # Populated on partial photo extraction (some fields were unreadable);
    # null on full success. FE renders this as a warning above the preview.
    reason: Optional[str] = None

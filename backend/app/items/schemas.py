from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

ItemCategory = Literal[
    "dairy", "meat", "grains", "bakery", "pantry",
    "produce", "frozen", "drinks", "cleaning", "other",
]

ItemUnit = Literal[
    "units", "kg", "g", "L", "ml", "packs", "loaves", "bottles", "cans", "bags",
]

ItemStatus = Literal["pending", "in_review", "approved", "rejected", "done"]

# Max length of the base64-encoded image POSTed to /items/scan-image.
# 7_500_000 chars ≈ a 5 MB image after base64 (1.37x expansion). Bump here
# if the mobile client starts sending larger photos.
SCAN_IMAGE_MAX_BASE64 = 7_500_000

ScanMediaType = Literal["image/jpeg", "image/png", "image/webp", "image/gif"]


class ScanImageRequest(BaseModel):
    image_base64: str = Field(min_length=1, max_length=SCAN_IMAGE_MAX_BASE64)
    media_type: ScanMediaType


class ProductScanResponse(BaseModel):
    name: Optional[str]
    brand: Optional[str]
    size: Optional[str]
    reason: Optional[str]


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: ItemCategory
    quantity: Decimal = Field(default=Decimal(1), gt=0, max_digits=10, decimal_places=3)
    unit: ItemUnit
    urgent: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    category: Optional[ItemCategory] = None
    quantity: Optional[Decimal] = Field(default=None, gt=0, max_digits=10, decimal_places=3)
    unit: Optional[ItemUnit] = None
    urgent: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self


class ItemStatusUpdate(BaseModel):
    status: ItemStatus


class ItemOut(BaseModel):
    id: str
    household_id: str
    name: str
    category: ItemCategory
    quantity: Decimal
    unit: ItemUnit
    urgent: bool
    status: ItemStatus
    notes: Optional[str]
    added_by: Optional[str]
    created_at: datetime
    updated_at: datetime


class ItemList(BaseModel):
    items: list[ItemOut]

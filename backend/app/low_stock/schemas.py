from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LowStockFlagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class LowStockFlagOut(BaseModel):
    id: str
    household_id: str
    name: str
    added_by: Optional[str]
    added_by_display_name: Optional[str]
    created_at: datetime
    updated_at: datetime


class LowStockFlagList(BaseModel):
    flags: list[LowStockFlagOut]

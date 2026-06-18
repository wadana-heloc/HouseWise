from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, StringConstraints


class LowStockFlagCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Trimmed; empty-after-trim rejected (FR-012). Case-insensitive uniqueness
    # per household is enforced by the DB unique (household_id, lower(name)).
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]


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

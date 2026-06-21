from datetime import datetime
from decimal import Decimal
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Same trim/length policy as items.name (BUG-004 / BUG-005). Store names and
# URLs are FE-supplied from the price-agent response.
StoreUrl = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]
StoreName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
Currency = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8)
]


class ToBuyEntryIn(BaseModel):
    """One row in the admin's buying decision — what + where + at what price."""

    model_config = ConfigDict(extra="forbid")

    item_id: str
    chosen_store_url: StoreUrl
    chosen_store_name: StoreName
    chosen_price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    currency: Currency = "AED"


class ToBuyReplaceRequest(BaseModel):
    """Replace the household's entire to-buy list with `entries`.

    Empty list is allowed and clears the list (admin can use the same
    endpoint to wipe everything). Each `item_id` must belong to the caller's
    household and have status in `pending` or `approved`.
    """

    model_config = ConfigDict(extra="forbid")

    entries: list[ToBuyEntryIn] = Field(default_factory=list, max_length=200)


class ToBuyEntryOut(BaseModel):
    id: str
    household_id: str
    item_id: str
    item_name: str
    quantity: Decimal
    unit: str
    chosen_store_url: str
    chosen_store_name: str
    chosen_price: Decimal
    currency: str
    snapshot_at: datetime
    added_by: Optional[str]
    created_at: datetime
    updated_at: datetime


class ToBuyListOut(BaseModel):
    entries: list[ToBuyEntryOut]
    item_count: int
    estimated_total: Decimal
    currency: str  # the currency of the first entry; mixed-currency lists not supported in v1

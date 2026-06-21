from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

# Trimmed, non-empty item string. FE concatenates `name + " " + qty + unit`
# (e.g. "milk 2L") before sending; we accept any reasonable string up to 200
# chars and pass it through to the price agent.
PriceItem = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class PriceSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PriceItem] = Field(default_factory=list, max_length=40)
    use_low_stock: bool = False

    @model_validator(mode="after")
    def _at_least_one_source(self):
        # Caught later in the handler with a clearer message if both end up
        # producing an empty list; this validator just rejects the request
        # shape where the caller obviously meant nothing.
        if not self.items and not self.use_low_stock:
            raise ValueError("provide 'items' or set 'use_low_stock' to true")
        return self


class StorePriceOut(BaseModel):
    store_url: str
    store_name: str
    price: Optional[float]
    currency: str
    product_url: Optional[str]
    product_name_as_found: Optional[str]
    unit_price: Optional[float]
    unit: Optional[str]


class ItemPriceOut(BaseModel):
    item: str
    prices: list[StorePriceOut]
    cheapest_store_url: Optional[str]
    cheapest_price: Optional[float]
    best_value_store_url: Optional[str]
    best_value_unit_price: Optional[float]
    best_value_unit: Optional[str]


class PriceSearchResponse(BaseModel):
    results: list[ItemPriceOut]

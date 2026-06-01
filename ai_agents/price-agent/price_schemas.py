from typing import Optional

from pydantic import BaseModel


class PriceRequest(BaseModel):
    items: list[str]
    stores: list[str]


class StorePriceResult(BaseModel):
    store_url: str
    store_name: str
    price: Optional[float]
    currency: str
    product_url: Optional[str]
    product_name_as_found: Optional[str]


class ItemPriceResult(BaseModel):
    item: str
    prices: list[StorePriceResult]
    cheapest_store_url: Optional[str]
    cheapest_price: Optional[float]


class PriceResponse(BaseModel):
    results: list[ItemPriceResult]

from datetime import datetime
from typing import Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

_HTTP_URL_ADAPTER = TypeAdapter(HttpUrl)


def _normalize_url(value: str) -> str:
    """Accept bare hosts ('carrefour.ae') and full URLs; return canonical https form.

    Pydantic's HttpUrl rejects bare hosts (no scheme). To preserve the UX of
    typing 'carrefour.ae' in the admin form, we prepend `https://` when the
    input doesn't already begin with http:// or https://, then validate.
    """
    if not isinstance(value, str):
        raise ValueError("url must be a string")
    stripped = value.strip()
    if not stripped:
        raise ValueError("url cannot be empty")
    lower = stripped.lower()
    if not (lower.startswith("http://") or lower.startswith("https://")):
        stripped = "https://" + stripped
    try:
        parsed = _HTTP_URL_ADAPTER.validate_python(stripped)
    except ValidationError as e:
        raise ValueError(f"invalid URL: {value}") from e
    if not parsed.host or "." not in parsed.host:
        raise ValueError(f"invalid URL: {value}")
    return str(parsed)


class StoreCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=500)

    @field_validator("url", mode="before")
    @classmethod
    def _normalize(cls, v):
        return _normalize_url(v)


class StoreUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    url: Optional[str] = Field(default=None, min_length=1, max_length=500)

    @field_validator("url", mode="before")
    @classmethod
    def _normalize(cls, v):
        if v is None:
            return v
        return _normalize_url(v)

    @model_validator(mode="after")
    def _at_least_one_field(self):
        if not self.model_fields_set:
            raise ValueError("PATCH body must include at least one field")
        return self


class StoreOut(BaseModel):
    id: str
    household_id: str
    name: str
    url: str
    added_by: Optional[str]
    created_at: datetime
    updated_at: datetime


class StoreList(BaseModel):
    stores: list[StoreOut]

# image_schemas.py
#
# Pydantic schemas for the Image agent.
# Defines the public return type ProductAnalysisResult and the internal
# input model ImageAnalysisRequest. Imported by image_agent.py.

from typing import Optional

from pydantic import BaseModel


class ImageAnalysisRequest(BaseModel):
    image_base64: str
    media_type: str


class ProductAnalysisResult(BaseModel):
    name: Optional[str]
    brand: Optional[str]
    size: Optional[str]
    reason: Optional[str]

import sys
sys.stdout.reconfigure(encoding="utf-8")

# image_agent.py
#
# Core logic for the Image agent.
# Exposes analyze_product_image() — the public entry point the backend calls.
#
# Pipeline: base64 image → Claude Haiku Vision → structured JSON
#
# Why vision instead of OCR + text:
#   OCR only reads text from labels — it fails entirely on unpackaged items
#   like apples, eggs, or vegetables that have no label text to extract.
#   Claude Vision understands the image spatially: it reads label text for
#   packaged products AND visually identifies unpackaged items by appearance.
#   Haiku is used instead of Sonnet to keep vision costs low (~6x cheaper per image).

import json

import anthropic
from dotenv import load_dotenv

load_dotenv()

from image_config import (
    IMAGE_MAX_TOKENS,
    IMAGE_MODEL_NAME,
    IMAGE_SYSTEM_PROMPT,
    IMAGE_USER_PROMPT,
)
from image_schemas import ProductAnalysisResult

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()


def _extract_text_from_response(response: anthropic.types.Message) -> str:
    # What:    Walks the response content blocks and returns the last text block.
    # Returns: str — the raw text content of the final text block, stripped of whitespace
    # Input:   response=<anthropic Message with a text block containing JSON>
    # Output:  '{"name": "Almarai Full Fat Milk", "brand": "Almarai", "size": "1L", "reason": null}'

    # str
    last_text_content = ""

    for content_block in response.content:
        if content_block.type == "text":
            last_text_content = content_block.text.strip()

    return last_text_content


def _strip_markdown_fences(raw_text: str) -> str:
    # What:    Removes accidental markdown code fences from the model output.
    #          The system prompt forbids them, but this acts as a safety net
    #          in case the model wraps the JSON in ```json ... ``` anyway.
    # Returns: str — cleaned text with no leading/trailing backtick fences
    # Input:   "```json\n{...}\n```"
    # Output:  "{...}"

    if not raw_text.startswith("```"):
        return raw_text

    # str — drop the opening ```json line by splitting on the first newline only
    content_after_opening_fence = raw_text.split("\n", 1)[-1]

    # str — drop everything from the last ``` onward (the closing fence)
    return content_after_opening_fence.rsplit("```", 1)[0].strip()


def _extract_json_object(text: str) -> str:
    # What:    Extracts the JSON object substring from text that may contain
    #          leading prose. Finds the first '{' and last '}' and returns only
    #          what is between them.
    # Returns: str — the raw JSON object substring, or the original text if no braces found
    # Input:   'Here is the product info:\n{"name": "Apple"}'
    # Output:  '{"name": "Apple"}'

    # int
    object_start_index = text.find("{")
    # int
    object_end_index = text.rfind("}")

    if object_start_index == -1 or object_end_index == -1:
        return text

    return text[object_start_index : object_end_index + 1]


def _parse_response(response: anthropic.types.Message) -> ProductAnalysisResult:
    # What:    Applies the standard three-step JSON cleaning pipeline to the model response,
    #          then validates and wraps the result in a ProductAnalysisResult.
    #          Returns a null-filled result with a reason string on any parse failure.
    # Returns: ProductAnalysisResult — parsed product fields, or nulls + reason on failure
    # Input:   response=<anthropic Message with text block '{"name":"Apple",...}'>
    # Output:  ProductAnalysisResult(name="Apple", brand=None, size=None, reason=None)

    # str — step 1: extract last text block
    raw_response_text = _extract_text_from_response(response)

    # str — step 2: strip markdown fences if model disobeyed the system prompt
    fence_stripped_text = _strip_markdown_fences(raw_response_text)

    # str — step 3: extract JSON object by slicing from first '{' to last '}'
    cleaned_response_text = _extract_json_object(fence_stripped_text)

    try:
        # dict
        parsed_data = json.loads(cleaned_response_text)

        return ProductAnalysisResult(
            name=parsed_data.get("name"),
            brand=parsed_data.get("brand"),
            size=parsed_data.get("size"),
            reason=parsed_data.get("reason"),
        )
    except (json.JSONDecodeError, Exception):
        return ProductAnalysisResult(
            name=None,
            brand=None,
            size=None,
            reason="Failed to parse model response",
        )


def analyze_product_image(image_base64: str, media_type: str) -> ProductAnalysisResult:
    # What:    Public entry point for the image agent.
    #          Sends the image directly to Claude Haiku Vision, which identifies the item
    #          by reading label text (packaged products) or visual appearance (unpackaged
    #          items like apples, eggs, vegetables).
    #          On any error (API failure, parse failure), returns a null-filled result
    #          with a reason string — never raises to the caller.
    # Returns: ProductAnalysisResult — extracted product fields, or nulls + reason on failure
    # Input:   image_base64="/9j/4AAQ...", media_type="image/jpeg"
    # Output:  ProductAnalysisResult(name="Apple", brand=None, size=None, reason=None)
    #          ProductAnalysisResult(name="Almarai Full Fat Milk", brand="Almarai", size="1L", reason=None)

    try:
        # anthropic.types.Message — Claude Vision identifies the item from the image
        response = client.messages.create(
            model=IMAGE_MODEL_NAME,
            max_tokens=IMAGE_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": IMAGE_SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_base64,
                            },
                        },
                        {
                            "type": "text",
                            "text": IMAGE_USER_PROMPT,
                        },
                    ],
                }
            ],
        )

        return _parse_response(response)

    except Exception as error:
        return ProductAnalysisResult(
            name=None,
            brand=None,
            size=None,
            reason=f"Agent error: {error}",
        )

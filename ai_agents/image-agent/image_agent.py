# image_agent.py
#
# Core logic for the Image agent.
# Exposes analyze_product_image() — the public entry point the backend calls.
#
# Pipeline:
#   base64 image  →  EasyOCR (free, local)  →  raw OCR text
#   raw OCR text  →  Claude text API (cheap)  →  structured JSON
#
# Using OCR + Claude text is significantly cheaper than Claude vision,
# because text tokens cost a fraction of image tokens.

import base64
import json

import anthropic
import easyocr
from dotenv import load_dotenv

# Walk up the directory tree to find the shared .env in ai_agents/
load_dotenv()

from image_config import (
    IMAGE_MAX_TOKENS,
    IMAGE_MODEL_NAME,
    IMAGE_OCR_CONFIDENCE_THRESHOLD,
    IMAGE_SYSTEM_PROMPT,
    IMAGE_USER_PROMPT,
)
from image_schemas import ProductAnalysisResult

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()

# easyocr.Reader — initialised once at module level so the model is loaded only once.
# The first initialisation downloads the English OCR model (~50 MB) if not cached.
# gpu=False ensures compatibility with CPU-only servers.
_ocr_reader = easyocr.Reader(["en"], gpu=False)


def _decode_image_bytes(image_base64: str) -> bytes:
    # What:    Decodes a base64-encoded image string into raw bytes.
    #          EasyOCR's readtext() accepts raw bytes directly.
    # Returns: bytes — raw image bytes
    # Input:   image_base64="/9j/4AAQ..."
    # Output:  b'\xff\xd8\xff...'

    return base64.b64decode(image_base64)


def _extract_ocr_text(image_bytes: bytes) -> str:
    # What:    Runs EasyOCR on the raw image bytes and returns all detected text
    #          fragments concatenated into a single string.
    #          Fragments below IMAGE_OCR_CONFIDENCE_THRESHOLD are dropped as noise.
    # Returns: str — all confident text fragments joined by spaces, or "" if none detected
    # Input:   image_bytes=b'\xff\xd8\xff...'
    # Output:  "Almarai Full Fat Milk 1L Best Before 12/2025"

    # list[tuple] — each element is (bounding_box, text, confidence_score)
    ocr_results = _ocr_reader.readtext(image_bytes)

    # list[str] — text fragments that meet the confidence threshold
    confident_text_fragments = [
        text
        for _, text, confidence in ocr_results
        if confidence >= IMAGE_OCR_CONFIDENCE_THRESHOLD
    ]

    return " ".join(confident_text_fragments)


def _call_claude_text(ocr_text: str) -> anthropic.types.Message:
    # What:    Sends the OCR-extracted text to Claude's text API (not vision).
    #          Claude receives plain text and structures it into JSON — this is far
    #          cheaper than passing the image directly via the vision API.
    #          The system prompt is cached so repeated calls are billed at 10% cost.
    # Returns: anthropic.types.Message — the raw API response
    # Input:   ocr_text="Almarai Full Fat Milk 1L Best Before 12/2025"
    # Output:  <anthropic Message with one text content block containing JSON>

    # str — user message: prompt prefix + the OCR output
    user_message_text = f"{IMAGE_USER_PROMPT}\n\n{ocr_text}"

    return client.messages.create(
        model=IMAGE_MODEL_NAME,
        max_tokens=IMAGE_MAX_TOKENS,
        system=[
            {
                "type": "text",
                "text": IMAGE_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {"role": "user", "content": user_message_text}
        ],
    )


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
    #          Uses split-on-newline + rsplit so backticks inside the JSON content
    #          (e.g. a brand name containing backticks) never break the extraction.
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
    # Input:   'Here is the product info:\n{"name": "Almarai"}'
    # Output:  '{"name": "Almarai"}'

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
    # Input:   response=<anthropic Message with text block '{"name":"Almarai",...}'>
    # Output:  ProductAnalysisResult(name="Almarai Full Fat Milk", brand="Almarai", size="1L", reason=None)

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
    #          Decodes the image, runs EasyOCR to extract text for free, then sends
    #          the OCR text to Claude's text API to structure it into JSON.
    #          On any error (OCR failure, API failure, parse failure), returns a
    #          null-filled result with a reason string — never raises to the caller.
    # Returns: ProductAnalysisResult — extracted product fields, or nulls + reason on failure
    # Input:   image_base64="/9j/4AAQ...", media_type="image/jpeg"
    # Output:  ProductAnalysisResult(name="Almarai Full Fat Milk", brand="Almarai", size="1L", reason=None)

    try:
        # bytes — raw image bytes decoded from base64
        image_bytes = _decode_image_bytes(image_base64)

        # str — raw text extracted from the image by EasyOCR (free, local)
        ocr_text = _extract_ocr_text(image_bytes)

        if not ocr_text.strip():
            return ProductAnalysisResult(
                name=None,
                brand=None,
                size=None,
                reason="No text detected in image",
            )

        # anthropic.types.Message — Claude structures the OCR text into JSON (text API, not vision)
        raw_response = _call_claude_text(ocr_text)

        return _parse_response(raw_response)

    except Exception as error:
        return ProductAnalysisResult(
            name=None,
            brand=None,
            size=None,
            reason=f"Agent error: {error}",
        )

import sys
sys.stdout.reconfigure(encoding="utf-8")

# recipe_photo_agent.py
#
# Core logic for the Recipe Photo agent.
# Exposes one public entry point the backend calls:
#   extract_recipe_from_image() — extracts a full recipe from a cookbook page photo
#
# Pipeline: base64 image → Claude Haiku Vision → structured JSON recipe
#
# Why vision instead of OCR + text:
#   Recipe pages use multi-column layouts, embedded photos, and fraction symbols (½, ¾).
#   OCR reads left-to-right and loses column structure, causing quantities to be
#   misaligned with ingredient names. Claude Vision understands spatial layout in one pass.
#   Haiku is used instead of Sonnet to keep vision costs low (~6x cheaper per image).

import json

import anthropic
from dotenv import load_dotenv

load_dotenv()

from recipe_photo_config import (
    RECIPE_PHOTO_EXTRACT_SYSTEM_PROMPT,
    RECIPE_PHOTO_EXTRACT_USER_TEXT,
    RECIPE_PHOTO_MAX_TOKENS,
    RECIPE_PHOTO_MODEL_NAME,
)
from recipe_photo_schemas import RecipePhotoResult

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()


def _extract_text_from_response(response: anthropic.types.Message) -> str:
    # What:    Walks the response content blocks and returns the last text block.
    #          The model may emit multiple content blocks; we always want the final text.
    # Returns: str — the raw text of the last text block, stripped of whitespace
    # Input:   response=<anthropic Message with a text block containing JSON>
    # Output:  '{"name": "Spaghetti Carbonara", ...}'

    # str
    last_text_content = ""

    for content_block in response.content:
        if content_block.type == "text":
            last_text_content = content_block.text.strip()

    return last_text_content


def _strip_markdown_fences(raw_text: str) -> str:
    # What:    Removes accidental markdown code fences from the model output.
    #          The system prompt forbids them, but this acts as a safety net.
    #          Uses split-on-newline + rsplit so backticks inside JSON content
    #          never break extraction.
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
    # Input:   'Here is the recipe:\n{"name": "Carbonara"}'
    # Output:  '{"name": "Carbonara"}'

    # int
    object_start_index = text.find("{")
    # int
    object_end_index = text.rfind("}")

    if object_start_index == -1 or object_end_index == -1:
        return text

    return text[object_start_index : object_end_index + 1]


def extract_recipe_from_image(image_base64: str, media_type: str) -> dict:
    # What:    Extracts a complete recipe from a photo of a cookbook page using Claude Vision.
    #          Sends the image directly to Haiku — no OCR preprocessing — so that
    #          column layouts, fractions, and section headers are understood spatially.
    # Returns: dict — a RecipePhotoResult with name, description, ingredients, instructions,
    #          tags, prep_minutes, servings, and reason (null on success, error string on failure)
    # Input:   image_base64="/9j/4AAQ..." (raw base64, no data URI prefix),
    #          media_type="image/jpeg"
    # Output:  {"name": "Spaghetti Carbonara", "ingredients": [...], ..., "reason": None}

    try:
        # anthropic.types.Message
        response = client.messages.create(
            model=RECIPE_PHOTO_MODEL_NAME,
            max_tokens=RECIPE_PHOTO_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": RECIPE_PHOTO_EXTRACT_SYSTEM_PROMPT,
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
                            "text": RECIPE_PHOTO_EXTRACT_USER_TEXT,
                        },
                    ],
                }
            ],
        )

        # str — step 1: extract last text block from the response
        raw_response_text = _extract_text_from_response(response)

        # str — step 2: strip markdown fences if model disobeyed the system prompt
        fence_stripped_text = _strip_markdown_fences(raw_response_text)

        # str — step 3: extract JSON object by slicing from first '{' to last '}'
        cleaned_response_text = _extract_json_object(fence_stripped_text)

        # dict
        parsed_data = json.loads(cleaned_response_text)

        return RecipePhotoResult(**parsed_data).model_dump()

    except Exception as agent_error:
        return RecipePhotoResult(reason=f"Extraction failed: {agent_error}").model_dump()

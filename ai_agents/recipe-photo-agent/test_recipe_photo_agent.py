import sys
sys.stdout.reconfigure(encoding="utf-8")

# test_recipe_photo_agent.py
#
# Unit tests for the Recipe Photo agent.
# Every function in recipe_photo_agent.py has at least one test here.
# The Anthropic client is mocked so no real API calls are made during testing.

import base64
import json
import unittest
from unittest.mock import MagicMock, patch

from recipe_photo_agent import (
    _extract_json_object,
    _extract_text_from_response,
    _strip_markdown_fences,
    extract_recipe_from_image,
)

# set[str] — the only valid ingredient categories the agent is allowed to produce
VALID_INGREDIENT_CATEGORIES = {
    "dairy", "meat", "grains", "bakery", "pantry",
    "produce", "frozen", "drinks", "cleaning", "other",
}

# dict — a minimal but complete extracted recipe used across multiple tests
SAMPLE_EXTRACTED_RECIPE = {
    "name": "Spaghetti Carbonara",
    "description": "A classic Roman pasta with eggs, cheese, and pancetta.",
    "ingredients": [
        {"name": "spaghetti", "quantity": "400", "unit": "g", "category": "grains"},
        {"name": "pancetta", "quantity": "150", "unit": "g", "category": "meat"},
        {"name": "eggs", "quantity": "4", "unit": "whole", "category": "dairy"},
        {"name": "parmesan", "quantity": "80", "unit": "g", "category": "dairy"},
    ],
    "instructions": "1. Cook pasta.\n2. Fry pancetta.\n3. Mix eggs and cheese.\n4. Combine off heat.",
    "tags": ["quick", "kid_friendly"],
    "prep_minutes": 25,
    "servings": 4,
    "reason": None,
}

# str — fake base64 payload (content irrelevant since client is mocked)
FAKE_IMAGE_BASE64 = base64.b64encode(b"fake_recipe_image").decode("utf-8")


def _make_mock_response(text: str) -> MagicMock:
    # What:    Builds a minimal mocked anthropic.types.Message with a single text block.
    #          Reused across tests to avoid duplicating mock setup boilerplate.
    # Returns: MagicMock — simulates an anthropic.types.Message
    # Input:   text='{"name": "Carbonara"}'
    # Output:  MagicMock with .content = [text_block]

    # MagicMock — simulates a single text content block
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = text

    # MagicMock — simulates anthropic.types.Message
    mock_response = MagicMock()
    mock_response.content = [text_block]

    return mock_response


class TestExtractTextFromResponse(unittest.TestCase):
    def test_returns_last_text_block(self):
        # What:    Verifies that the last text block is returned when multiple text blocks exist.
        # Returns: None
        # Input:   mocked response with two text blocks
        # Output:  the text from the second block, stripped of whitespace

        # MagicMock
        first_block = MagicMock()
        first_block.type = "text"
        first_block.text = "first block"

        # MagicMock
        second_block = MagicMock()
        second_block.type = "text"
        second_block.text = '  {"name": "Carbonara"}  '

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [first_block, second_block]

        self.assertEqual(_extract_text_from_response(mock_response), '{"name": "Carbonara"}')

    def test_returns_empty_string_when_no_text_blocks(self):
        # What:    Verifies that an empty string is returned when the response has no text blocks.
        # Returns: None
        # Input:   mocked response with empty content list
        # Output:  ""

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = []

        self.assertEqual(_extract_text_from_response(mock_response), "")


class TestStripMarkdownFences(unittest.TestCase):
    def test_strips_json_labelled_fence(self):
        # What:    Verifies that ```json ... ``` fences are removed correctly.
        # Returns: None
        # Input:   "```json\n{...}\n```"
        # Output:  "{...}"

        self.assertEqual(_strip_markdown_fences("```json\n{...}\n```"), "{...}")

    def test_strips_plain_fence(self):
        # What:    Verifies that ``` ... ``` fences without a language tag are removed.
        # Returns: None
        # Input:   "```\n{...}\n```"
        # Output:  "{...}"

        self.assertEqual(_strip_markdown_fences("```\n{...}\n```"), "{...}")

    def test_plain_text_passes_through_unchanged(self):
        # What:    Verifies that text with no fences is returned as-is.
        # Returns: None
        # Input:   '{"name": "Carbonara"}'
        # Output:  '{"name": "Carbonara"}'

        # str
        plain_json = '{"name": "Carbonara"}'

        self.assertEqual(_strip_markdown_fences(plain_json), plain_json)

    def test_backticks_inside_json_are_not_corrupted(self):
        # What:    Verifies that backticks inside the JSON content are preserved.
        #          The safe split("\n", 1) + rsplit("```", 1) pattern must not treat
        #          inner backticks as fence markers.
        # Returns: None
        # Input:   "```json\n{\"name\": \"`special`\"}\n```"
        # Output:  "{\"name\": \"`special`\"}"

        fenced_with_inner_backticks = "```json\n{\"name\": \"`special`\"}\n```"

        self.assertEqual(
            _strip_markdown_fences(fenced_with_inner_backticks),
            "{\"name\": \"`special`\"}",
        )


class TestExtractJsonObject(unittest.TestCase):
    def test_extracts_object_from_prose_prefix(self):
        # What:    Verifies that leading prose before the JSON object is stripped.
        # Returns: None
        # Input:   'Here is the recipe:\n{"name": "Carbonara"}'
        # Output:  '{"name": "Carbonara"}'

        self.assertEqual(
            _extract_json_object('Here is the recipe:\n{"name": "Carbonara"}'),
            '{"name": "Carbonara"}',
        )

    def test_plain_object_passes_through(self):
        # What:    Verifies that text already starting with '{' is returned unchanged.
        # Returns: None
        # Input:   '{"name": "Carbonara"}'
        # Output:  '{"name": "Carbonara"}'

        # str
        plain_json = '{"name": "Carbonara"}'

        self.assertEqual(_extract_json_object(plain_json), plain_json)

    def test_returns_original_when_no_braces(self):
        # What:    Verifies that text with no braces is returned as-is so the caller
        #          receives a JSONDecodeError rather than a silent empty result.
        # Returns: None
        # Input:   "no braces here"
        # Output:  "no braces here"

        self.assertEqual(_extract_json_object("no braces here"), "no braces here")


class TestExtractRecipeFromImage(unittest.TestCase):
    @patch("recipe_photo_agent.client")
    def test_returns_valid_recipe_structure_on_success(self, mock_client):
        # What:    Verifies that extract_recipe_from_image maps a valid Claude JSON response
        #          into a dict with all expected recipe fields populated.
        # Returns: None
        # Input:   mocked client returning SAMPLE_EXTRACTED_RECIPE as JSON
        # Output:  dict with name, description, ingredients, instructions, tags,
        #          prep_minutes, servings populated and reason=None

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_EXTRACTED_RECIPE)
        )

        # dict
        result = extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/jpeg")

        self.assertEqual(result["name"], "Spaghetti Carbonara")
        self.assertIsNotNone(result["description"])
        self.assertIsInstance(result["ingredients"], list)
        self.assertGreater(len(result["ingredients"]), 0)
        self.assertIsNotNone(result["instructions"])
        self.assertIsInstance(result["tags"], list)
        self.assertIsInstance(result["prep_minutes"], int)
        self.assertIsInstance(result["servings"], int)
        self.assertIsNone(result["reason"])

    @patch("recipe_photo_agent.client")
    def test_all_ingredient_categories_are_valid(self, mock_client):
        # What:    Verifies that every ingredient in the extracted recipe has a category
        #          that belongs to the allowed set.
        # Returns: None
        # Input:   mocked client returning SAMPLE_EXTRACTED_RECIPE with grains, meat, dairy
        # Output:  all ingredient categories are in VALID_INGREDIENT_CATEGORIES

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_EXTRACTED_RECIPE)
        )

        # dict
        result = extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/jpeg")

        for ingredient in result["ingredients"]:
            self.assertIn(
                ingredient["category"],
                VALID_INGREDIENT_CATEGORIES,
                msg=f"Unexpected category '{ingredient['category']}' for ingredient '{ingredient['name']}'",
            )

    @patch("recipe_photo_agent.client")
    def test_returns_reason_on_malformed_json(self, mock_client):
        # What:    Verifies that extract_recipe_from_image returns a dict with reason set
        #          (not an exception) when Claude returns non-JSON text.
        # Returns: None
        # Input:   mocked client returning plain prose instead of JSON
        # Output:  dict where reason is not None, all recipe fields are None or empty

        mock_client.messages.create.return_value = _make_mock_response(
            "I cannot extract a recipe from this image."
        )

        # dict
        result = extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/jpeg")

        self.assertIsNotNone(result["reason"])
        self.assertIsNone(result["name"])
        self.assertEqual(result["ingredients"], [])

    @patch("recipe_photo_agent.client")
    def test_returns_reason_on_api_error(self, mock_client):
        # What:    Verifies that extract_recipe_from_image returns a dict with reason set
        #          when the Anthropic API raises an exception.
        # Returns: None
        # Input:   mocked client raising an exception
        # Output:  dict where reason contains "Extraction failed"

        mock_client.messages.create.side_effect = Exception("API unavailable")

        # dict
        result = extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/jpeg")

        self.assertIsNotNone(result["reason"])
        self.assertIn("Extraction failed", result["reason"])

    @patch("recipe_photo_agent.client")
    def test_non_recipe_image_returns_reason(self, mock_client):
        # What:    Verifies that when Claude identifies the image as not a recipe page,
        #          the agent returns a dict with all recipe fields null and reason set.
        #          The agent itself does not raise — it parses Claude's null-filled response.
        # Returns: None
        # Input:   mocked client returning a null-filled JSON with a reason string
        # Output:  dict where all recipe fields are None and reason explains the image content

        # dict — Claude returns this when the image is not a recipe page
        non_recipe_response = {
            "name": None,
            "description": None,
            "ingredients": [],
            "instructions": None,
            "tags": [],
            "prep_minutes": None,
            "servings": None,
            "reason": "This image appears to be a landscape photo, not a recipe page.",
        }

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(non_recipe_response)
        )

        # dict
        result = extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/jpeg")

        self.assertIsNone(result["name"])
        self.assertEqual(result["ingredients"], [])
        self.assertIsNotNone(result["reason"])

    @patch("recipe_photo_agent.client")
    def test_image_is_passed_in_correct_format(self, mock_client):
        # What:    Verifies that the image is sent to Claude in the correct content block
        #          format — type "image", source type "base64", with the right media_type.
        #          This ensures the backend's base64 payload reaches Claude intact.
        # Returns: None
        # Input:   FAKE_IMAGE_BASE64 with media_type="image/png", mocked client
        # Output:  client.messages.create called with an image content block containing
        #          the base64 data and the correct media_type

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_EXTRACTED_RECIPE)
        )

        extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/png")

        mock_client.messages.create.assert_called_once()

        # dict — kwargs passed to messages.create
        call_kwargs = mock_client.messages.create.call_args.kwargs

        # list — the content blocks sent in the user message
        content_blocks = call_kwargs["messages"][0]["content"]

        # dict — find the image block (second block in the content list)
        image_block = content_blocks[1]

        self.assertEqual(image_block["type"], "image")
        self.assertEqual(image_block["source"]["type"], "base64")
        self.assertEqual(image_block["source"]["media_type"], "image/png")
        self.assertEqual(image_block["source"]["data"], FAKE_IMAGE_BASE64)

    @patch("recipe_photo_agent.client")
    def test_uses_haiku_model(self, mock_client):
        # What:    Verifies that the Haiku model is used (not Sonnet) to keep vision
        #          costs low. Haiku is ~6x cheaper per image than Sonnet for this task.
        # Returns: None
        # Input:   mocked client, any valid call
        # Output:  model passed to messages.create is the Haiku model ID

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_EXTRACTED_RECIPE)
        )

        extract_recipe_from_image(FAKE_IMAGE_BASE64, "image/jpeg")

        # dict
        call_kwargs = mock_client.messages.create.call_args.kwargs

        self.assertEqual(call_kwargs["model"], "claude-haiku-4-5-20251001")

    @patch("recipe_photo_agent.client")
    def test_never_raises_on_empty_inputs(self, mock_client):
        # What:    Verifies that extract_recipe_from_image never raises even when called
        #          with empty inputs — it always returns a dict.
        # Returns: None
        # Input:   image_base64="", media_type=""
        # Output:  dict (with reason set, but no exception raised)

        mock_client.messages.create.side_effect = Exception("empty input triggered error")

        try:
            result = extract_recipe_from_image("", "")
            self.assertIsInstance(result, dict)
            self.assertIn("reason", result)
        except Exception:
            self.fail("extract_recipe_from_image raised an exception instead of returning a fallback dict")


if __name__ == "__main__":
    unittest.main()

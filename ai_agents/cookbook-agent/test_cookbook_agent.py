import sys
sys.stdout.reconfigure(encoding="utf-8")

# test_cookbook_agent.py
#
# Unit tests for the Cookbook agent.
# Every function in cookbook_agent.py has at least one test here.
# The Anthropic client is mocked so no real API calls are made during testing.

import json
import unittest
from unittest.mock import MagicMock, patch

from cookbook_agent import (
    _extract_json_object,
    _extract_text_from_response,
    _strip_markdown_fences,
    generate_recipe,
    personalize_recipe_description,
)

# set[str] — the only valid ingredient categories the agent is allowed to produce
VALID_INGREDIENT_CATEGORIES = {
    "dairy", "meat", "grains", "bakery", "pantry",
    "produce", "frozen", "drinks", "cleaning", "other",
}

# dict — a minimal but complete recipe used across multiple generate_recipe tests
SAMPLE_RECIPE = {
    "name": "High-Protein Pasta",
    "description": "A rich tomato pasta secretly packed with protein.",
    "ingredients": [
        {"name": "chicken breast", "quantity": "500", "unit": "g", "category": "meat"},
        {"name": "penne pasta", "quantity": "400", "unit": "g", "category": "grains"},
    ],
    "instructions": "1. Boil pasta.\n2. Cook chicken.\n3. Combine and serve.",
    "tags": ["high_protein", "kid_friendly"],
    "prep_minutes": 30,
    "servings": 4,
    "reason": None,
}

# dict — a minimal member profile used across personalize_recipe_description tests
SAMPLE_ADULT_MEMBER = {
    "display_name": "Nour",
    "age_group": "adult",
    "taste_preferences": "loves spicy food",
    "health_preferences": {
        "high_protein": True,
        "low_calories": False,
        "low_carbs": False,
        "low_sugar": False,
        "whole_grain": False,
    },
}


def _make_mock_response(text: str) -> MagicMock:
    # What:    Builds a minimal mocked anthropic.types.Message with a single text block.
    #          Reused across tests to avoid duplicating mock setup boilerplate.
    # Returns: MagicMock — simulates an anthropic.types.Message
    # Input:   text='{"name": "Pasta"}'
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

        # MagicMock — simulates the first text content block
        first_block = MagicMock()
        first_block.type = "text"
        first_block.text = "first block"

        # MagicMock — simulates the final text content block
        second_block = MagicMock()
        second_block.type = "text"
        second_block.text = '  {"name": "Pasta"}  '

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [first_block, second_block]

        self.assertEqual(_extract_text_from_response(mock_response), '{"name": "Pasta"}')

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
        # Input:   '{"name": "Pasta"}'
        # Output:  '{"name": "Pasta"}'

        # str
        plain_json = '{"name": "Pasta"}'

        self.assertEqual(_strip_markdown_fences(plain_json), plain_json)

    def test_backticks_inside_json_are_not_corrupted(self):
        # What:    Verifies that backticks appearing inside the JSON content are preserved.
        #          The safe split("\n", 1) + rsplit("```", 1) pattern must not mistake
        #          inner backticks for fence markers.
        # Returns: None
        # Input:   "```json\n{\"name\": \"`special`\"}\n```"
        # Output:  "{\"name\": \"`special`\"}"

        # str — JSON where the value itself contains backticks
        fenced_with_inner_backticks = "```json\n{\"name\": \"`special`\"}\n```"

        self.assertEqual(
            _strip_markdown_fences(fenced_with_inner_backticks),
            "{\"name\": \"`special`\"}",
        )


class TestExtractJsonObject(unittest.TestCase):
    def test_extracts_object_from_prose_prefix(self):
        # What:    Verifies that leading prose before the JSON object is stripped.
        # Returns: None
        # Input:   'Here is the recipe:\n{"name": "Pasta"}'
        # Output:  '{"name": "Pasta"}'

        self.assertEqual(
            _extract_json_object('Here is the recipe:\n{"name": "Pasta"}'),
            '{"name": "Pasta"}',
        )

    def test_plain_object_passes_through(self):
        # What:    Verifies that text already starting with '{' is returned unchanged.
        # Returns: None
        # Input:   '{"name": "Pasta"}'
        # Output:  '{"name": "Pasta"}'

        # str
        plain_json = '{"name": "Pasta"}'

        self.assertEqual(_extract_json_object(plain_json), plain_json)

    def test_returns_original_when_no_braces(self):
        # What:    Verifies that text with no braces is returned as-is so the caller
        #          receives a JSONDecodeError rather than a silent empty result.
        # Returns: None
        # Input:   "no braces here"
        # Output:  "no braces here"

        self.assertEqual(_extract_json_object("no braces here"), "no braces here")


class TestGenerateRecipe(unittest.TestCase):
    @patch("cookbook_agent.client")
    def test_returns_valid_recipe_structure_on_success(self, mock_client):
        # What:    Verifies that generate_recipe maps a valid Claude JSON response
        #          into a dict with all expected recipe fields populated.
        # Returns: None
        # Input:   mocked client returning SAMPLE_RECIPE as JSON
        # Output:  dict with name, description, ingredients, instructions, tags,
        #          prep_minutes, servings populated and reason=None

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_RECIPE)
        )

        # dict
        result = generate_recipe(
            "A high-protein pasta kids will eat",
            {"household_members": [SAMPLE_ADULT_MEMBER]},
        )

        self.assertEqual(result["name"], "High-Protein Pasta")
        self.assertIsNotNone(result["description"])
        self.assertIsInstance(result["ingredients"], list)
        self.assertGreater(len(result["ingredients"]), 0)
        self.assertIsNotNone(result["instructions"])
        self.assertIsInstance(result["tags"], list)
        self.assertIsInstance(result["prep_minutes"], int)
        self.assertIsInstance(result["servings"], int)
        self.assertIsNone(result["reason"])

    @patch("cookbook_agent.client")
    def test_all_ingredient_categories_are_valid(self, mock_client):
        # What:    Verifies that every ingredient in the response has a category
        #          that belongs to the allowed set. This enforces the constraint
        #          the backend and shopping list features depend on.
        # Returns: None
        # Input:   mocked client returning SAMPLE_RECIPE with meat and grains categories
        # Output:  all ingredient categories are in VALID_INGREDIENT_CATEGORIES

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_RECIPE)
        )

        # dict
        result = generate_recipe("Any prompt", {})

        for ingredient in result["ingredients"]:
            self.assertIn(
                ingredient["category"],
                VALID_INGREDIENT_CATEGORIES,
                msg=f"Unexpected category '{ingredient['category']}' for ingredient '{ingredient['name']}'",
            )

    @patch("cookbook_agent.client")
    def test_returns_reason_on_malformed_json(self, mock_client):
        # What:    Verifies that generate_recipe returns a dict with reason set
        #          (not an exception) when Claude returns non-JSON text.
        # Returns: None
        # Input:   mocked client returning plain prose instead of JSON
        # Output:  dict where reason is not None, all recipe fields are None or empty

        mock_client.messages.create.return_value = _make_mock_response(
            "Sorry, I cannot generate a recipe right now."
        )

        # dict
        result = generate_recipe("Any prompt", {})

        self.assertIsNotNone(result["reason"])
        self.assertIsNone(result["name"])
        self.assertEqual(result["ingredients"], [])

    @patch("cookbook_agent.client")
    def test_returns_reason_on_api_error(self, mock_client):
        # What:    Verifies that generate_recipe returns a dict with reason set
        #          when the Anthropic API raises an exception.
        # Returns: None
        # Input:   mocked client raising an exception
        # Output:  dict where reason contains "Agent error"

        mock_client.messages.create.side_effect = Exception("API unavailable")

        # dict
        result = generate_recipe("Any prompt", {})

        self.assertIsNotNone(result["reason"])
        self.assertIn("Agent error", result["reason"])

    @patch("cookbook_agent.client")
    def test_never_raises_on_empty_inputs(self, mock_client):
        # What:    Verifies that generate_recipe never raises even when called with
        #          an empty prompt and empty context — it always returns a dict.
        # Returns: None
        # Input:   prompt="", household_context={}
        # Output:  dict (with reason set, but no exception raised)

        mock_client.messages.create.side_effect = Exception("empty input triggered error")

        # This call must not raise — it must return a dict with reason set
        try:
            result = generate_recipe("", {})
            self.assertIsInstance(result, dict)
            self.assertIn("reason", result)
        except Exception:
            self.fail("generate_recipe raised an exception instead of returning a fallback dict")

    @patch("cookbook_agent.client")
    def test_passes_prompt_and_context_to_api(self, mock_client):
        # What:    Verifies that the prompt and household_context are serialized
        #          and included in the content sent to the Anthropic API.
        # Returns: None
        # Input:   mocked client, prompt="pasta", household_context={"tag_hints": ["quick"]}
        # Output:  client.messages.create called once; user payload contains the prompt text

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_RECIPE)
        )

        generate_recipe("pasta", {"tag_hints": ["quick"]})

        mock_client.messages.create.assert_called_once()

        # dict — kwargs passed to messages.create
        call_kwargs = mock_client.messages.create.call_args.kwargs

        # str — the second content block holds the serialized user payload
        user_payload_text = call_kwargs["messages"][0]["content"][1]["text"]

        self.assertIn("pasta", user_payload_text)
        self.assertIn("quick", user_payload_text)


class TestPersonalizeRecipeDescription(unittest.TestCase):
    @patch("cookbook_agent.client")
    def test_returns_plain_text_on_success(self, mock_client):
        # What:    Verifies that personalize_recipe_description returns the model's
        #          plain text response directly, with no JSON parsing applied.
        # Returns: None
        # Input:   mocked client returning a two-sentence personalized description
        # Output:  the exact plain text string returned by the model

        # str — the personalized description Claude would return
        expected_description = "This dish is packed with protein to fuel your recovery. You'll love the rich tomato sauce."

        mock_client.messages.create.return_value = _make_mock_response(expected_description)

        # str
        result = personalize_recipe_description(
            recipe=SAMPLE_RECIPE,
            member_profile=SAMPLE_ADULT_MEMBER,
            recent_history=[],
        )

        self.assertEqual(result, expected_description)

    @patch("cookbook_agent.client")
    def test_returns_empty_string_on_api_error(self, mock_client):
        # What:    Verifies that personalize_recipe_description returns an empty string
        #          (not an exception) when the Anthropic API raises.
        # Returns: None
        # Input:   mocked client raising an exception
        # Output:  ""

        mock_client.messages.create.side_effect = Exception("API unavailable")

        # str
        result = personalize_recipe_description(
            recipe=SAMPLE_RECIPE,
            member_profile=SAMPLE_ADULT_MEMBER,
            recent_history=[],
        )

        self.assertEqual(result, "")

    @patch("cookbook_agent.client")
    def test_never_raises_on_empty_inputs(self, mock_client):
        # What:    Verifies that personalize_recipe_description never raises even when
        #          called with empty recipe, member profile, and history.
        # Returns: None
        # Input:   all empty dicts and lists
        # Output:  str returned (empty or otherwise), no exception raised

        mock_client.messages.create.side_effect = Exception("empty input triggered error")

        try:
            result = personalize_recipe_description(
                recipe={},
                member_profile={},
                recent_history=[],
            )
            self.assertIsInstance(result, str)
        except Exception:
            self.fail("personalize_recipe_description raised an exception instead of returning an empty string")

    @patch("cookbook_agent.client")
    def test_passes_recipe_and_member_context_to_api(self, mock_client):
        # What:    Verifies that the recipe name and member display name are serialized
        #          and included in the content sent to the Anthropic API.
        # Returns: None
        # Input:   SAMPLE_RECIPE and SAMPLE_ADULT_MEMBER, mocked client
        # Output:  client.messages.create called once; payload contains recipe name and member name

        mock_client.messages.create.return_value = _make_mock_response("Great choice for you!")

        personalize_recipe_description(
            recipe=SAMPLE_RECIPE,
            member_profile=SAMPLE_ADULT_MEMBER,
            recent_history=[{"recipe_name": "Chicken Curry", "eaten_on": "2026-05-25", "reaction": "loved"}],
        )

        mock_client.messages.create.assert_called_once()

        # dict — kwargs passed to messages.create
        call_kwargs = mock_client.messages.create.call_args.kwargs

        # str — second content block holds the serialized user payload
        user_payload_text = call_kwargs["messages"][0]["content"][1]["text"]

        self.assertIn("High-Protein Pasta", user_payload_text)
        self.assertIn("Nour", user_payload_text)
        self.assertIn("Chicken Curry", user_payload_text)


if __name__ == "__main__":
    unittest.main()

import sys
sys.stdout.reconfigure(encoding="utf-8")

# test_meal_plan_agent.py
#
# Unit tests for the Meal Plan agent.
# Every function in meal_plan_agent.py has at least one test here.
# The Anthropic client is mocked so no real API calls are made during testing.

import json
import unittest
from unittest.mock import MagicMock, patch

from meal_plan_agent import (
    _extract_json_object,
    _extract_text_from_response,
    _strip_markdown_fences,
    generate_weekly_plan,
)

# set[str] — the only valid prep labels the agent is allowed to produce
VALID_PREP_LABELS = {"prep", "reheat", "fresh"}

# set[str] — the only valid ingredient categories the agent is allowed to produce
VALID_INGREDIENT_CATEGORIES = {
    "dairy", "meat", "grains", "bakery", "pantry",
    "produce", "frozen", "drinks", "cleaning", "other",
}

# list[dict] — a complete 7-day plan used across multiple generate_weekly_plan tests
SAMPLE_WEEKLY_PLAN = {
    "ai_summary": (
        "Monday's salmon is scheduled first to use the freshest fish. "
        "Tuesday is a reheat day for Nour who is busy. "
        "Burgers on Thursday honour Ahmed's request. "
        "Pasta on Saturday uses pantry staples that last all week."
    ),
    "days": [
        {
            "day_of_week": 1,
            "recipe_id": "uuid-salmon",
            "meal_name": "Grilled Salmon",
            "prep_label": "prep",
            "notes": "Cook double batch — leftovers used Tuesday",
            "suggested_ingredients": [],
        },
        {
            "day_of_week": 2,
            "recipe_id": "uuid-salmon",
            "meal_name": "Grilled Salmon",
            "prep_label": "reheat",
            "notes": "Busy day for Nour — reheating Monday's salmon",
            "suggested_ingredients": [],
        },
        {
            "day_of_week": 3,
            "recipe_id": "uuid-curry",
            "meal_name": "Chicken Curry",
            "prep_label": "fresh",
            "notes": None,
            "suggested_ingredients": [],
        },
        {
            "day_of_week": 4,
            "recipe_id": None,
            "meal_name": "Homemade Burgers",
            "prep_label": "fresh",
            "notes": "Ahmed's request — no match in cookbook",
            "suggested_ingredients": [
                {"name": "beef mince", "quantity": "500", "unit": "g", "category": "meat"},
                {"name": "burger buns", "quantity": "4", "unit": "whole", "category": "bakery"},
            ],
        },
        {
            "day_of_week": 5,
            "recipe_id": "uuid-lentil",
            "meal_name": "Lentil Soup",
            "prep_label": "prep",
            "notes": "Cook large pot — leftovers used Sunday",
            "suggested_ingredients": [],
        },
        {
            "day_of_week": 6,
            "recipe_id": None,
            "meal_name": "Pasta Aglio e Olio",
            "prep_label": "fresh",
            "notes": None,
            "suggested_ingredients": [
                {"name": "spaghetti", "quantity": "400", "unit": "g", "category": "grains"},
                {"name": "garlic", "quantity": "6", "unit": "cloves", "category": "produce"},
                {"name": "olive oil", "quantity": "4", "unit": "tbsp", "category": "pantry"},
            ],
        },
        {
            "day_of_week": 7,
            "recipe_id": "uuid-lentil",
            "meal_name": "Lentil Soup",
            "prep_label": "reheat",
            "notes": "Leftover from Friday",
            "suggested_ingredients": [],
        },
    ],
    "reason": None,
}

# dict — a minimal household context used across generate_weekly_plan tests
SAMPLE_CONTEXT = {
    "week_start": "2026-06-08",
    "household_members": [
        {
            "display_name": "Nour",
            "age_group": "adult",
            "taste_preferences": "loves spicy food",
            "health_preferences": {"high_protein": True},
            "busy_days": [2],
            "meal_requests": [],
        },
        {
            "display_name": "Ahmed",
            "age_group": "kid",
            "taste_preferences": "hates vegetables",
            "health_preferences": {"low_sugar": True},
            "busy_days": [],
            "meal_requests": [{"description": "I want burgers", "recipe_id": None}],
        },
    ],
    "available_recipes": [
        {
            "id": "uuid-salmon",
            "name": "Grilled Salmon",
            "tags": ["high_protein", "quick"],
            "prep_minutes": 20,
            "ingredient_categories": ["meat", "produce", "pantry"],
        },
        {
            "id": "uuid-curry",
            "name": "Chicken Curry",
            "tags": ["high_protein"],
            "prep_minutes": 40,
            "ingredient_categories": ["meat", "produce", "dairy", "pantry"],
        },
        {
            "id": "uuid-lentil",
            "name": "Lentil Soup",
            "tags": ["vegetarian", "prep_once_eat_twice"],
            "prep_minutes": 35,
            "ingredient_categories": ["pantry", "produce"],
        },
    ],
    "low_stock_items": ["milk", "eggs"],
    "last_week_meals": ["Pasta Carbonara", "Beef Stir Fry", "Shakshuka"],
}


def _make_mock_response(text: str) -> MagicMock:
    # What:    Builds a minimal mocked anthropic.types.Message with a single text block.
    #          Reused across tests to avoid duplicating mock setup boilerplate.
    # Returns: MagicMock — simulates an anthropic.types.Message
    # Input:   text='{"ai_summary": "...", "days": [...]}'
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
        # What:    Verifies that the last text block is returned when multiple exist.
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
        second_block.text = '  {"ai_summary": "Great week"}  '

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [first_block, second_block]

        self.assertEqual(
            _extract_text_from_response(mock_response),
            '{"ai_summary": "Great week"}',
        )

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
        # Input:   '{"ai_summary": "Great week"}'
        # Output:  '{"ai_summary": "Great week"}'

        # str
        plain_json = '{"ai_summary": "Great week"}'

        self.assertEqual(_strip_markdown_fences(plain_json), plain_json)


class TestExtractJsonObject(unittest.TestCase):
    def test_extracts_object_from_prose_prefix(self):
        # What:    Verifies that leading prose before the JSON object is stripped.
        # Returns: None
        # Input:   'Here is the plan:\n{"ai_summary": "..."}'
        # Output:  '{"ai_summary": "..."}'

        self.assertEqual(
            _extract_json_object('Here is the plan:\n{"ai_summary": "..."}'),
            '{"ai_summary": "..."}',
        )

    def test_plain_object_passes_through(self):
        # What:    Verifies that text already starting with '{' is returned unchanged.
        # Returns: None
        # Input:   '{"ai_summary": "..."}'
        # Output:  '{"ai_summary": "..."}'

        # str
        plain_json = '{"ai_summary": "..."}'

        self.assertEqual(_extract_json_object(plain_json), plain_json)

    def test_returns_original_when_no_braces(self):
        # What:    Verifies that text with no braces is returned as-is so the caller
        #          receives a JSONDecodeError rather than a silent empty result.
        # Returns: None
        # Input:   "no braces here"
        # Output:  "no braces here"

        self.assertEqual(_extract_json_object("no braces here"), "no braces here")


class TestGenerateWeeklyPlan(unittest.TestCase):
    @patch("meal_plan_agent.client")
    def test_returns_exactly_7_days(self, mock_client):
        # What:    Verifies that generate_weekly_plan always returns exactly 7 day entries.
        #          This is a hard constraint the backend and frontend depend on.
        # Returns: None
        # Input:   mocked client returning SAMPLE_WEEKLY_PLAN with 7 days
        # Output:  result["days"] has length 7

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_WEEKLY_PLAN)
        )

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        self.assertEqual(len(result["days"]), 7)

    @patch("meal_plan_agent.client")
    def test_day_of_week_covers_1_through_7(self, mock_client):
        # What:    Verifies that the 7 day entries cover each day 1–7 with no gaps
        #          and no duplicates (Mon through Sun, one dinner per day).
        # Returns: None
        # Input:   mocked client returning SAMPLE_WEEKLY_PLAN
        # Output:  set of day_of_week values equals {1, 2, 3, 4, 5, 6, 7}

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_WEEKLY_PLAN)
        )

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        # set[int]
        day_numbers = {day["day_of_week"] for day in result["days"]}

        self.assertEqual(day_numbers, {1, 2, 3, 4, 5, 6, 7})

    @patch("meal_plan_agent.client")
    def test_all_prep_labels_are_valid(self, mock_client):
        # What:    Verifies that every day's prep_label is one of the three allowed values.
        # Returns: None
        # Input:   mocked client returning SAMPLE_WEEKLY_PLAN with prep/reheat/fresh labels
        # Output:  all prep_label values are in VALID_PREP_LABELS

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_WEEKLY_PLAN)
        )

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        for day in result["days"]:
            self.assertIn(
                day["prep_label"],
                VALID_PREP_LABELS,
                msg=f"Invalid prep_label '{day['prep_label']}' on day {day['day_of_week']}",
            )

    @patch("meal_plan_agent.client")
    def test_suggested_ingredient_categories_are_valid(self, mock_client):
        # What:    Verifies that every ingredient in suggested_ingredients has a category
        #          that belongs to the allowed set. Only populated for invented meals.
        # Returns: None
        # Input:   mocked client returning SAMPLE_WEEKLY_PLAN with burgers and pasta as invented meals
        # Output:  all suggested ingredient categories are in VALID_INGREDIENT_CATEGORIES

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_WEEKLY_PLAN)
        )

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        for day in result["days"]:
            for ingredient in day["suggested_ingredients"]:
                self.assertIn(
                    ingredient["category"],
                    VALID_INGREDIENT_CATEGORIES,
                    msg=f"Invalid category '{ingredient['category']}' in suggested_ingredients for '{day['meal_name']}'",
                )

    @patch("meal_plan_agent.client")
    def test_cookbook_recipes_have_empty_suggested_ingredients(self, mock_client):
        # What:    Verifies that days with a recipe_id set never populate suggested_ingredients.
        #          The backend fetches those ingredients from the database — the agent must not duplicate them.
        # Returns: None
        # Input:   mocked client returning SAMPLE_WEEKLY_PLAN
        # Output:  all days where recipe_id is not None have suggested_ingredients == []

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_WEEKLY_PLAN)
        )

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        for day in result["days"]:
            if day["recipe_id"] is not None:
                self.assertEqual(
                    day["suggested_ingredients"],
                    [],
                    msg=f"Day {day['day_of_week']} has recipe_id set but also has suggested_ingredients",
                )

    @patch("meal_plan_agent.client")
    def test_returns_reason_on_malformed_json(self, mock_client):
        # What:    Verifies that generate_weekly_plan returns a dict with reason set
        #          (not an exception) when Claude returns non-JSON text.
        # Returns: None
        # Input:   mocked client returning plain prose instead of JSON
        # Output:  dict where reason is not None and days is empty

        mock_client.messages.create.return_value = _make_mock_response(
            "I cannot generate a meal plan right now."
        )

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        self.assertIsNotNone(result["reason"])
        self.assertEqual(result["days"], [])

    @patch("meal_plan_agent.client")
    def test_returns_reason_on_api_error(self, mock_client):
        # What:    Verifies that generate_weekly_plan returns a dict with reason set
        #          when the Anthropic API raises an exception.
        # Returns: None
        # Input:   mocked client raising an exception
        # Output:  dict where reason contains "Agent error"

        mock_client.messages.create.side_effect = Exception("API unavailable")

        # dict
        result = generate_weekly_plan(SAMPLE_CONTEXT)

        self.assertIsNotNone(result["reason"])
        self.assertIn("Agent error", result["reason"])

    @patch("meal_plan_agent.client")
    def test_never_raises_on_empty_context(self, mock_client):
        # What:    Verifies that generate_weekly_plan never raises even when called
        #          with an empty context dict — it always returns a dict.
        # Returns: None
        # Input:   context={}
        # Output:  dict (with reason set, but no exception raised)

        mock_client.messages.create.side_effect = Exception("empty context triggered error")

        try:
            result = generate_weekly_plan({})
            self.assertIsInstance(result, dict)
            self.assertIn("reason", result)
        except Exception:
            self.fail("generate_weekly_plan raised an exception instead of returning a fallback dict")

    @patch("meal_plan_agent.client")
    def test_passes_last_week_meals_and_ingredient_categories_to_api(self, mock_client):
        # What:    Verifies that last_week_meals and ingredient_categories are serialized
        #          and included in the content sent to the Anthropic API.
        #          These are the two new fields added beyond the original plan design.
        # Returns: None
        # Input:   SAMPLE_CONTEXT with last_week_meals and ingredient_categories, mocked client
        # Output:  user payload text contains last_week_meals items and a recipe's ingredient_categories

        mock_client.messages.create.return_value = _make_mock_response(
            json.dumps(SAMPLE_WEEKLY_PLAN)
        )

        generate_weekly_plan(SAMPLE_CONTEXT)

        mock_client.messages.create.assert_called_once()

        # dict — kwargs passed to messages.create
        call_kwargs = mock_client.messages.create.call_args.kwargs

        # str — the second content block holds the serialized context payload
        user_payload_text = call_kwargs["messages"][0]["content"][1]["text"]

        self.assertIn("Pasta Carbonara", user_payload_text)        # last_week_meals
        self.assertIn("ingredient_categories", user_payload_text)   # new field
        self.assertIn("Grilled Salmon", user_payload_text)          # available_recipes


if __name__ == "__main__":
    unittest.main()

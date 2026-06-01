# test_price_agent.py
#
# Unit tests for the Price agent.
# Every function in price_agent.py has at least one test here.
# The Anthropic client is mocked so no real API calls are made during testing.

import json
import unittest
from unittest.mock import MagicMock, patch

from price_agent import (
    _build_null_result_for_item,
    _calculate_max_tokens,
    _call_agent,
    _extract_json_array,
    _extract_text_from_response,
    _strip_markdown_fences,
    build_user_prompt,
    search_grocery_prices,
)
from price_config import (
    PRICE_BATCH_SIZE,
    PRICE_TOKENS_BASE_OVERHEAD,
    PRICE_TOKENS_MAXIMUM,
    PRICE_TOKENS_MINIMUM,
    PRICE_TOKENS_PER_ITEM_PER_STORE,
)


class TestBuildUserPrompt(unittest.TestCase):
    def test_items_appear_in_prompt(self):
        # What:    Verifies that all item names are present in the generated prompt.
        # Returns: None
        # Input:   items=["milk 1L", "eggs 12pcs"], stores=["https://store.com"]
        # Output:  assertion passes

        # str
        prompt = build_user_prompt(["milk 1L", "eggs 12pcs"], ["https://store.com"])

        self.assertIn("milk 1L", prompt)
        self.assertIn("eggs 12pcs", prompt)

    def test_stores_appear_in_prompt_as_readable_names(self):
        # What:    Verifies that store domains appear in the prompt with https://www. stripped
        #          so the model reads them as human-readable store names, not raw URLs.
        # Returns: None
        # Input:   items=["milk 1L"], stores=["https://www.carrefouruae.com", "https://www.spinneys.com"]
        # Output:  prompt contains "carrefouruae.com" and "spinneys.com" (no https://www. prefix)

        # str
        prompt = build_user_prompt(
            ["milk 1L"],
            ["https://www.carrefouruae.com", "https://www.spinneys.com"],
        )

        self.assertIn("carrefouruae.com", prompt)
        self.assertIn("spinneys.com", prompt)
        self.assertNotIn("https://www.", prompt)

    def test_prompt_does_not_contain_json_schema(self):
        # What:    Verifies the user prompt no longer embeds the JSON schema.
        #          The schema was moved to PRICE_SYSTEM_PROMPT so it is cached
        #          and not re-billed on every call via the user prompt.
        # Returns: None
        # Input:   items=["milk 1L"], stores=["https://store.com"]
        # Output:  assertion passes

        # str
        prompt = build_user_prompt(["milk 1L"], ["https://store.com"])

        self.assertNotIn("cheapest_store_url", prompt)
        self.assertNotIn("product_name_as_found", prompt)


class TestCalculateMaxTokens(unittest.TestCase):
    def test_formula_matches_constants_for_typical_batch(self):
        # What:    Verifies the token budget formula: base + (items * stores * per_pair),
        #          for a typical batch where the result falls between the min and max.
        # Returns: None
        # Input:   item_count=4, store_count=4
        # Output:  PRICE_TOKENS_BASE_OVERHEAD + 4 * 4 * PRICE_TOKENS_PER_ITEM_PER_STORE

        # int
        expected = PRICE_TOKENS_BASE_OVERHEAD + (4 * 4 * PRICE_TOKENS_PER_ITEM_PER_STORE)

        self.assertEqual(_calculate_max_tokens(4, 4), expected)

    def test_minimum_floor_applied_for_tiny_batch(self):
        # What:    Verifies that a very small batch never drops below PRICE_TOKENS_MINIMUM.
        # Returns: None
        # Input:   item_count=1, store_count=1  (calculated would be below the floor)
        # Output:  PRICE_TOKENS_MINIMUM

        self.assertEqual(_calculate_max_tokens(1, 1), PRICE_TOKENS_MINIMUM)

    def test_maximum_cap_applied_for_huge_batch(self):
        # What:    Verifies that a very large batch is capped at PRICE_TOKENS_MAXIMUM.
        # Returns: None
        # Input:   item_count=100, store_count=100  (calculated would exceed the cap)
        # Output:  PRICE_TOKENS_MAXIMUM

        self.assertEqual(_calculate_max_tokens(100, 100), PRICE_TOKENS_MAXIMUM)

    def test_grows_with_more_items(self):
        # What:    Verifies that a larger item count produces a larger token budget
        #          when the result stays between the floor and the cap.
        # Returns: None
        # Input:   (10 items, 4 stores) vs (4 items, 4 stores)
        # Output:  budget for 10 items is greater than budget for 4 items

        self.assertGreater(_calculate_max_tokens(10, 4), _calculate_max_tokens(4, 4))


class TestBuildNullResultForItem(unittest.TestCase):
    def test_all_price_fields_are_none(self):
        # What:    Verifies that every price and unit_price field in the fallback result is None.
        # Returns: None
        # Input:   item="milk 1L", stores=["https://store.com"]
        # Output:  assertion passes

        # dict
        result = _build_null_result_for_item("milk 1L", ["https://store.com"])

        self.assertEqual(result["item"], "milk 1L")
        self.assertIsNone(result["cheapest_store_url"])
        self.assertIsNone(result["cheapest_price"])
        self.assertIsNone(result["best_value_store_url"])
        self.assertIsNone(result["best_value_unit_price"])
        self.assertIsNone(result["best_value_unit"])
        self.assertIsNone(result["prices"][0]["price"])
        self.assertIsNone(result["prices"][0]["product_url"])
        self.assertIsNone(result["prices"][0]["unit_price"])
        self.assertIsNone(result["prices"][0]["unit"])

    def test_one_price_entry_per_store(self):
        # What:    Verifies the prices list contains exactly one entry per store.
        # Returns: None
        # Input:   item="eggs", stores=["https://a.com", "https://b.com", "https://c.com"]
        # Output:  assertion passes

        # list[str]
        three_stores = ["https://a.com", "https://b.com", "https://c.com"]

        # dict
        result = _build_null_result_for_item("eggs", three_stores)

        self.assertEqual(len(result["prices"]), 3)


class TestExtractTextFromResponse(unittest.TestCase):
    def test_returns_last_text_block(self):
        # What:    Verifies that the last text block is returned when multiple text blocks exist.
        # Returns: None
        # Input:   mocked response with two text blocks
        # Output:  the text from the second block, stripped

        # MagicMock — simulates the first text content block
        first_text_block = MagicMock()
        first_text_block.type = "text"
        first_text_block.text = "first block"

        # MagicMock — simulates the second (final) text content block
        second_text_block = MagicMock()
        second_text_block.type = "text"
        second_text_block.text = "  final block  "

        # MagicMock — simulates anthropic.types.Message
        mock_response = MagicMock()
        mock_response.content = [first_text_block, second_text_block]

        self.assertEqual(_extract_text_from_response(mock_response), "final block")

    def test_tool_use_blocks_are_ignored(self):
        # What:    Verifies that tool_use blocks are skipped and only text blocks are returned.
        # Returns: None
        # Input:   mocked response with a tool_use block followed by a text block
        # Output:  the text from the text block

        # MagicMock — simulates a web_search tool_use block
        tool_use_block = MagicMock()
        tool_use_block.type = "tool_use"

        # MagicMock — simulates the final text block containing JSON
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = '[{"item": "milk"}]'

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [tool_use_block, text_block]

        self.assertEqual(_extract_text_from_response(mock_response), '[{"item": "milk"}]')

    def test_returns_empty_string_when_no_text_blocks(self):
        # What:    Verifies that an empty string is returned when there are no text blocks.
        # Returns: None
        # Input:   mocked response with only tool_use blocks
        # Output:  empty string

        # MagicMock
        tool_use_block = MagicMock()
        tool_use_block.type = "tool_use"

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [tool_use_block]

        self.assertEqual(_extract_text_from_response(mock_response), "")


class TestStripMarkdownFences(unittest.TestCase):
    def test_strips_json_labelled_fence(self):
        # What:    Verifies that ```json ... ``` fences are removed correctly.
        # Returns: None
        # Input:   "```json\n[{...}]\n```"
        # Output:  "[{...}]"

        self.assertEqual(_strip_markdown_fences("```json\n[{...}]\n```"), "[{...}]")

    def test_strips_plain_fence(self):
        # What:    Verifies that ``` ... ``` fences without a language tag are removed.
        # Returns: None
        # Input:   "```\n[{...}]\n```"
        # Output:  "[{...}]"

        self.assertEqual(_strip_markdown_fences("```\n[{...}]\n```"), "[{...}]")

    def test_plain_text_passes_through_unchanged(self):
        # What:    Verifies that text without any fences is returned as-is.
        # Returns: None
        # Input:   '[{"item": "milk"}]'
        # Output:  '[{"item": "milk"}]'

        # str
        json_without_fences = '[{"item": "milk"}]'

        self.assertEqual(_strip_markdown_fences(json_without_fences), json_without_fences)


class TestExtractJsonArray(unittest.TestCase):
    def test_extracts_array_from_prose_prefix(self):
        # What:    Verifies that leading prose before the JSON array is stripped.
        # Returns: None
        # Input:   "Based on my search...\n[{\"item\": \"milk\"}]"
        # Output:  '[{"item": "milk"}]'

        # str
        text_with_prose = 'Based on my search results, here is the data:\n[{"item": "milk"}]'

        self.assertEqual(_extract_json_array(text_with_prose), '[{"item": "milk"}]')

    def test_plain_array_passes_through(self):
        # What:    Verifies that text already starting with '[' is returned unchanged.
        # Returns: None
        # Input:   '[{"item": "milk"}]'
        # Output:  '[{"item": "milk"}]'

        # str
        plain_array = '[{"item": "milk"}]'

        self.assertEqual(_extract_json_array(plain_array), plain_array)

    def test_returns_original_text_when_no_brackets(self):
        # What:    Verifies that text with no brackets is returned as-is (caller handles the parse error).
        # Returns: None
        # Input:   "no brackets here"
        # Output:  "no brackets here"

        # str
        text_without_brackets = "no brackets here"

        self.assertEqual(_extract_json_array(text_without_brackets), text_without_brackets)


class TestCallAgent(unittest.TestCase):
    @patch("price_agent.client")
    def test_returns_parsed_json_on_valid_response(self, mock_client):
        # What:    Verifies that _call_agent parses and returns valid JSON from the API.
        # Returns: None
        # Input:   mocked Anthropic client returning a valid JSON text block
        # Output:  the parsed list of dicts

        # list[dict]
        expected_price_result = [
            {
                "item": "milk 1L",
                "prices": [],
                "cheapest_store_url": None,
                "cheapest_price": None,
            }
        ]

        # MagicMock — simulates the text block the model returns
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(expected_price_result)

        # MagicMock — simulates anthropic.types.Message
        mock_response = MagicMock()
        mock_response.content = [text_block]

        mock_client.messages.create.return_value = mock_response

        # list[dict]
        result = _call_agent(["milk 1L"], ["https://store.com"])

        self.assertEqual(result, expected_price_result)

    @patch("price_agent.client")
    def test_returns_null_fallback_on_invalid_json(self, mock_client):
        # What:    Verifies that _call_agent returns null-filled results when the model
        #          returns text that cannot be parsed as JSON.
        # Returns: None
        # Input:   mocked Anthropic client returning non-JSON text
        # Output:  list with one null-filled dict per item

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Sorry, I could not find any prices."

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]

        mock_client.messages.create.return_value = mock_response

        # list[str]
        items = ["milk 1L", "eggs 12pcs"]
        # list[str]
        stores = ["https://store.com"]

        # list[dict]
        result = _call_agent(items, stores)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["item"], "milk 1L")
        self.assertIsNone(result[0]["cheapest_price"])
        self.assertEqual(result[1]["item"], "eggs 12pcs")


class TestSearchGroceryPrices(unittest.TestCase):
    @patch("price_agent._call_agent")
    def test_single_call_for_small_item_list(self, mock_call_agent):
        # What:    Verifies that _call_agent is called exactly once when the item
        #          count is at or below PRICE_BATCH_SIZE.
        # Returns: None
        # Input:   3 items (well below PRICE_BATCH_SIZE)
        # Output:  _call_agent called exactly once with all 3 items

        mock_call_agent.return_value = []

        # list[str]
        small_item_list = ["item1", "item2", "item3"]

        search_grocery_prices(small_item_list, ["https://store.com"])

        mock_call_agent.assert_called_once_with(small_item_list, ["https://store.com"])

    @patch("price_agent._call_agent")
    def test_two_calls_when_list_exceeds_batch_size(self, mock_call_agent):
        # What:    Verifies that _call_agent is called twice when the item count
        #          is PRICE_BATCH_SIZE + 1 (one full batch plus one leftover item).
        # Returns: None
        # Input:   PRICE_BATCH_SIZE + 1 items
        # Output:  _call_agent called exactly twice

        mock_call_agent.return_value = []

        # list[str] — one item over the batch limit to force two calls
        oversized_item_list = [f"item{i}" for i in range(PRICE_BATCH_SIZE + 1)]

        search_grocery_prices(oversized_item_list, ["https://store.com"])

        self.assertEqual(mock_call_agent.call_count, 2)

    @patch("price_agent._call_agent")
    def test_results_from_all_batches_are_merged(self, mock_call_agent):
        # What:    Verifies that results from multiple batches are combined into
        #          a single flat list with no nesting.
        # Returns: None
        # Input:   two batches, each returning one result dict
        # Output:  flat list of two result dicts

        mock_call_agent.side_effect = [
            [{"item": "item0", "prices": [], "cheapest_store_url": None, "cheapest_price": None}],
            [{"item": "item1", "prices": [], "cheapest_store_url": None, "cheapest_price": None}],
        ]

        # list[str]
        oversized_item_list = [f"item{i}" for i in range(PRICE_BATCH_SIZE + 1)]

        # list[dict]
        merged_results = search_grocery_prices(oversized_item_list, ["https://store.com"])

        self.assertEqual(len(merged_results), 2)
        self.assertEqual(merged_results[0]["item"], "item0")
        self.assertEqual(merged_results[1]["item"], "item1")


if __name__ == "__main__":
    unittest.main()

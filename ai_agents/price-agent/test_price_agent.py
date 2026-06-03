# test_price_agent.py
#
# Unit tests for the Price agent.
# The Anthropic client is mocked so no real API calls are made during testing.

import json
import unittest
from unittest.mock import MagicMock, patch

from price_agent import (
    _build_null_result_for_item,
    _call_agent,
    _compute_summary_fields,
    _extract_json_array,
    _extract_text_from_response,
    _strip_markdown_fences,
    build_user_prompt,
    search_grocery_prices,
)
from price_config import PRICE_BATCH_SIZE


class TestBuildUserPrompt(unittest.TestCase):
    def test_items_appear_in_prompt(self):
        prompt = build_user_prompt(["milk 1L", "eggs 12pcs"], ["https://store.com"])
        self.assertIn("milk 1L", prompt)
        self.assertIn("eggs 12pcs", prompt)

    def test_stores_appear_in_prompt_as_readable_names(self):
        prompt = build_user_prompt(
            ["milk 1L"],
            ["https://www.carrefouruae.com", "https://www.spinneys.com"],
        )
        self.assertIn("carrefouruae.com", prompt)
        self.assertIn("spinneys.com", prompt)
        self.assertNotIn("https://www.", prompt)

    def test_prompt_does_not_contain_json_schema(self):
        prompt = build_user_prompt(["milk 1L"], ["https://store.com"])
        self.assertNotIn("cheapest_store_url", prompt)
        self.assertNotIn("product_name_as_found", prompt)


class TestComputeSummaryFields(unittest.TestCase):
    def test_cheapest_price_ignores_null_entries(self):
        result = {
            "item": "milk 1L",
            "prices": [
                {"store_url": "https://a.com", "price": 10.0, "unit_price": None, "unit": None},
                {"store_url": "https://b.com", "price": 8.0,  "unit_price": None, "unit": None},
                {"store_url": "https://c.com", "price": None, "unit_price": None, "unit": None},
            ],
        }
        out = _compute_summary_fields(result)
        self.assertEqual(out["cheapest_price"], 8.0)
        self.assertEqual(out["cheapest_store_url"], "https://b.com")

    def test_best_value_uses_unit_price_over_raw_price(self):
        result = {
            "item": "milk 1L",
            "prices": [
                {"store_url": "https://a.com", "price": 10.0, "unit_price": 2.0, "unit": "AED/100ml"},
                {"store_url": "https://b.com", "price": 8.0,  "unit_price": 1.5, "unit": "AED/100ml"},
            ],
        }
        out = _compute_summary_fields(result)
        self.assertEqual(out["best_value_store_url"], "https://b.com")
        self.assertEqual(out["best_value_unit_price"], 1.5)
        self.assertEqual(out["best_value_unit"], "AED/100ml")

    def test_best_value_falls_back_to_cheapest_when_no_unit_prices(self):
        result = {
            "item": "milk 1L",
            "prices": [
                {"store_url": "https://a.com", "price": 10.0, "unit_price": None, "unit": None},
                {"store_url": "https://b.com", "price": 8.0,  "unit_price": None, "unit": None},
            ],
        }
        out = _compute_summary_fields(result)
        self.assertEqual(out["best_value_store_url"], "https://b.com")
        self.assertIsNone(out["best_value_unit_price"])
        self.assertIsNone(out["best_value_unit"])

    def test_all_null_when_all_prices_are_null(self):
        result = {
            "item": "milk 1L",
            "prices": [
                {"store_url": "https://a.com", "price": None, "unit_price": None, "unit": None},
            ],
        }
        out = _compute_summary_fields(result)
        self.assertIsNone(out["cheapest_price"])
        self.assertIsNone(out["cheapest_store_url"])
        self.assertIsNone(out["best_value_store_url"])
        self.assertIsNone(out["best_value_unit_price"])


class TestBuildNullResultForItem(unittest.TestCase):
    def test_all_price_fields_are_none(self):
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
        result = _build_null_result_for_item("eggs", ["https://a.com", "https://b.com", "https://c.com"])
        self.assertEqual(len(result["prices"]), 3)


class TestExtractTextFromResponse(unittest.TestCase):
    def test_returns_last_text_block(self):
        first_text_block = MagicMock()
        first_text_block.type = "text"
        first_text_block.text = "first block"

        second_text_block = MagicMock()
        second_text_block.type = "text"
        second_text_block.text = "  final block  "

        mock_response = MagicMock()
        mock_response.content = [first_text_block, second_text_block]

        self.assertEqual(_extract_text_from_response(mock_response), "final block")

    def test_tool_use_blocks_are_ignored(self):
        tool_use_block = MagicMock()
        tool_use_block.type = "tool_use"

        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = '[{"item": "milk"}]'

        mock_response = MagicMock()
        mock_response.content = [tool_use_block, text_block]

        self.assertEqual(_extract_text_from_response(mock_response), '[{"item": "milk"}]')

    def test_returns_empty_string_when_no_text_blocks(self):
        tool_use_block = MagicMock()
        tool_use_block.type = "tool_use"

        mock_response = MagicMock()
        mock_response.content = [tool_use_block]

        self.assertEqual(_extract_text_from_response(mock_response), "")


class TestStripMarkdownFences(unittest.TestCase):
    def test_strips_json_labelled_fence(self):
        self.assertEqual(_strip_markdown_fences("```json\n[{...}]\n```"), "[{...}]")

    def test_strips_plain_fence(self):
        self.assertEqual(_strip_markdown_fences("```\n[{...}]\n```"), "[{...}]")

    def test_plain_text_passes_through_unchanged(self):
        json_without_fences = '[{"item": "milk"}]'
        self.assertEqual(_strip_markdown_fences(json_without_fences), json_without_fences)


class TestExtractJsonArray(unittest.TestCase):
    def test_extracts_array_from_prose_prefix(self):
        text_with_prose = 'Based on my search results, here is the data:\n[{"item": "milk"}]'
        self.assertEqual(_extract_json_array(text_with_prose), '[{"item": "milk"}]')

    def test_plain_array_passes_through(self):
        plain_array = '[{"item": "milk"}]'
        self.assertEqual(_extract_json_array(plain_array), plain_array)

    def test_returns_original_text_when_no_brackets(self):
        text_without_brackets = "no brackets here"
        self.assertEqual(_extract_json_array(text_without_brackets), text_without_brackets)


class TestCallAgent(unittest.TestCase):
    @patch("price_agent.client")
    def test_returns_parsed_json_on_valid_response(self, mock_client):
        # Model returns only item + prices; Python adds summary fields.
        mock_model_output = [{"item": "milk 1L", "prices": []}]

        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(mock_model_output)

        mock_response = MagicMock()
        mock_response.content = [text_block]
        mock_client.messages.create.return_value = mock_response

        result = _call_agent(["milk 1L"], ["https://store.com"])

        self.assertEqual(result, [{
            "item": "milk 1L",
            "prices": [],
            "cheapest_store_url": None,
            "cheapest_price": None,
            "best_value_store_url": None,
            "best_value_unit_price": None,
            "best_value_unit": None,
        }])

    @patch("price_agent.client")
    def test_returns_null_fallback_on_invalid_json(self, mock_client):
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Sorry, I could not find any prices."

        mock_response = MagicMock()
        mock_response.content = [text_block]
        mock_client.messages.create.return_value = mock_response

        result = _call_agent(["milk 1L", "eggs 12pcs"], ["https://store.com"])

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["item"], "milk 1L")
        self.assertIsNone(result[0]["cheapest_price"])
        self.assertEqual(result[1]["item"], "eggs 12pcs")


class TestSearchGroceryPrices(unittest.TestCase):
    @patch("price_agent._call_agent")
    def test_single_call_for_small_item_list(self, mock_call_agent):
        mock_call_agent.return_value = []
        small_item_list = ["item1", "item2", "item3"]
        search_grocery_prices(small_item_list, ["https://store.com"])
        mock_call_agent.assert_called_once_with(small_item_list, ["https://store.com"])

    @patch("price_agent._call_agent")
    def test_two_calls_when_list_exceeds_batch_size(self, mock_call_agent):
        mock_call_agent.return_value = []
        oversized_item_list = [f"item{i}" for i in range(PRICE_BATCH_SIZE + 1)]
        search_grocery_prices(oversized_item_list, ["https://store.com"])
        self.assertEqual(mock_call_agent.call_count, 2)

    @patch("price_agent._call_agent")
    def test_results_from_all_batches_are_merged(self, mock_call_agent):
        mock_call_agent.side_effect = [
            [{"item": "item0", "prices": [], "cheapest_store_url": None, "cheapest_price": None}],
            [{"item": "item1", "prices": [], "cheapest_store_url": None, "cheapest_price": None}],
        ]
        oversized_item_list = [f"item{i}" for i in range(PRICE_BATCH_SIZE + 1)]
        merged_results = search_grocery_prices(oversized_item_list, ["https://store.com"])
        self.assertEqual(len(merged_results), 2)
        self.assertEqual(merged_results[0]["item"], "item0")
        self.assertEqual(merged_results[1]["item"], "item1")


if __name__ == "__main__":
    unittest.main()

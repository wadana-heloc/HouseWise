import sys
sys.stdout.reconfigure(encoding="utf-8")

# test_image_agent.py
#
# Unit tests for the Image agent.
# Every function in image_agent.py has at least one test here.
# The Anthropic client is mocked so no real API calls occur during unit testing.

import base64
import json
import unittest
from unittest.mock import MagicMock, patch

from image_agent import (
    _extract_json_object,
    _extract_text_from_response,
    _parse_response,
    _strip_markdown_fences,
    analyze_product_image,
)


class TestExtractTextFromResponse(unittest.TestCase):
    def test_returns_last_text_block(self):
        # What:    Verifies that the last text block is returned when multiple exist.
        # Returns: None
        # Input:   mocked response with two text blocks
        # Output:  the text from the second block, stripped

        # MagicMock
        first_block = MagicMock()
        first_block.type = "text"
        first_block.text = "first"

        # MagicMock
        second_block = MagicMock()
        second_block.type = "text"
        second_block.text = '  {"name": "Apple"}  '

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [first_block, second_block]

        self.assertEqual(_extract_text_from_response(mock_response), '{"name": "Apple"}')

    def test_returns_empty_string_when_no_text_blocks(self):
        # What:    Verifies that an empty string is returned when there are no text blocks.
        # Returns: None
        # Input:   mocked response with empty content
        # Output:  ""

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
        # What:    Verifies that text without fences is returned as-is.
        # Returns: None
        # Input:   '{"name": "Apple"}'
        # Output:  '{"name": "Apple"}'

        # str
        plain_json = '{"name": "Apple"}'

        self.assertEqual(_strip_markdown_fences(plain_json), plain_json)


class TestExtractJsonObject(unittest.TestCase):
    def test_extracts_object_from_prose_prefix(self):
        # What:    Verifies that leading prose before the JSON object is stripped.
        # Returns: None
        # Input:   'Here is the info:\n{"name": "Apple"}'
        # Output:  '{"name": "Apple"}'

        self.assertEqual(
            _extract_json_object('Here is the info:\n{"name": "Apple"}'),
            '{"name": "Apple"}',
        )

    def test_plain_object_passes_through(self):
        # What:    Verifies that text already starting with '{' is returned unchanged.
        # Returns: None
        # Input:   '{"name": "Apple"}'
        # Output:  '{"name": "Apple"}'

        # str
        plain = '{"name": "Apple"}'

        self.assertEqual(_extract_json_object(plain), plain)

    def test_returns_original_when_no_braces(self):
        # What:    Verifies that text with no braces is returned as-is so the caller
        #          receives a JSONDecodeError rather than a cryptic slice error.
        # Returns: None
        # Input:   "no braces here"
        # Output:  "no braces here"

        self.assertEqual(_extract_json_object("no braces here"), "no braces here")


class TestParseResponse(unittest.TestCase):
    def test_returns_product_result_for_packaged_item(self):
        # What:    Verifies that _parse_response maps JSON fields to ProductAnalysisResult
        #          for a labelled packaged product.
        # Returns: None
        # Input:   mocked response with valid product JSON (name, brand, size)
        # Output:  ProductAnalysisResult with name, brand, size populated

        # dict
        product_json = {"name": "Full Fat Milk", "brand": "Almarai", "size": "1L", "reason": None}

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(product_json)

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]

        # ProductAnalysisResult
        result = _parse_response(mock_response)

        self.assertEqual(result.name, "Full Fat Milk")
        self.assertEqual(result.brand, "Almarai")
        self.assertEqual(result.size, "1L")
        self.assertIsNone(result.reason)

    def test_returns_name_only_for_unpackaged_item(self):
        # What:    Verifies that _parse_response handles an unpackaged item (e.g. apple)
        #          where only name is returned and brand/size are null.
        # Returns: None
        # Input:   mocked response with name="Apple", brand=null, size=null
        # Output:  ProductAnalysisResult with name="Apple", brand=None, size=None, reason=None

        # dict
        item_json = {"name": "Apple", "brand": None, "size": None, "reason": None}

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(item_json)

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]

        # ProductAnalysisResult
        result = _parse_response(mock_response)

        self.assertEqual(result.name, "Apple")
        self.assertIsNone(result.brand)
        self.assertIsNone(result.size)
        self.assertIsNone(result.reason)

    def test_returns_null_fields_with_reason_on_unidentifiable(self):
        # What:    Verifies that a response with null fields and a reason string
        #          maps correctly to ProductAnalysisResult.
        # Returns: None
        # Input:   mocked response with null fields and reason text
        # Output:  ProductAnalysisResult with all product fields null, reason populated

        # dict
        null_json = {"name": None, "brand": None, "size": None, "reason": "Image too blurry to identify"}

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(null_json)

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]

        # ProductAnalysisResult
        result = _parse_response(mock_response)

        self.assertIsNone(result.name)
        self.assertEqual(result.reason, "Image too blurry to identify")

    def test_returns_fallback_on_malformed_json(self):
        # What:    Verifies that _parse_response returns a null-filled fallback
        #          (not an exception) when the model returns unparseable text.
        # Returns: None
        # Input:   mocked response with non-JSON text
        # Output:  ProductAnalysisResult with all fields null, reason="Failed to parse model response"

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "I cannot identify this product."

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]

        # ProductAnalysisResult
        result = _parse_response(mock_response)

        self.assertIsNone(result.name)
        self.assertEqual(result.reason, "Failed to parse model response")


class TestAnalyzeProductImage(unittest.TestCase):
    @patch("image_agent.client")
    def test_returns_result_for_packaged_product(self, mock_client):
        # What:    Verifies the full pipeline: image is sent to Claude Vision,
        #          which returns a structured JSON for a packaged product.
        # Returns: None
        # Input:   mocked Claude returning JSON for "Lays Chips 165g"
        # Output:  ProductAnalysisResult(name="Chips", brand="Lays", size="165g")

        # dict
        product_json = {"name": "Chips", "brand": "Lays", "size": "165g", "reason": None}

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(product_json)

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]
        mock_client.messages.create.return_value = mock_response

        # str — fake base64 (any valid base64 works since the API is mocked)
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        # ProductAnalysisResult
        result = analyze_product_image(fake_base64, "image/jpeg")

        self.assertEqual(result.name, "Chips")
        self.assertEqual(result.brand, "Lays")
        self.assertEqual(result.size, "165g")

    @patch("image_agent.client")
    def test_returns_name_only_for_unpackaged_item(self, mock_client):
        # What:    Verifies the full pipeline for an unpackaged item like an apple.
        #          Claude Vision identifies it visually; brand and size are null.
        # Returns: None
        # Input:   mocked Claude returning JSON for a visually identified apple
        # Output:  ProductAnalysisResult(name="Apple", brand=None, size=None, reason=None)

        # dict
        item_json = {"name": "Apple", "brand": None, "size": None, "reason": None}

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps(item_json)

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [text_block]
        mock_client.messages.create.return_value = mock_response

        # str
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        # ProductAnalysisResult
        result = analyze_product_image(fake_base64, "image/jpeg")

        self.assertEqual(result.name, "Apple")
        self.assertIsNone(result.brand)
        self.assertIsNone(result.size)
        self.assertIsNone(result.reason)

    @patch("image_agent.client")
    def test_passes_image_to_claude_vision_correctly(self, mock_client):
        # What:    Verifies that analyze_product_image passes the image as a base64
        #          vision content block to the Claude API (not as text).
        # Returns: None
        # Input:   mocked client, fake base64 image
        # Output:  client.messages.create called with an image content block

        # MagicMock
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json.dumps({"name": "Egg", "brand": None, "size": None, "reason": None})

        mock_response = MagicMock()
        mock_response.content = [text_block]
        mock_client.messages.create.return_value = mock_response

        # str
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        analyze_product_image(fake_base64, "image/jpeg")

        # dict — keyword args passed to messages.create
        call_kwargs = mock_client.messages.create.call_args.kwargs

        self.assertEqual(call_kwargs["model"], "claude-haiku-4-5-20251001")

        # list — the content blocks in the user message
        content_blocks = call_kwargs["messages"][0]["content"]

        # bool — at least one content block must be an image block
        image_blocks = [b for b in content_blocks if b.get("type") == "image"]
        self.assertEqual(len(image_blocks), 1)
        self.assertEqual(image_blocks[0]["source"]["data"], fake_base64)
        self.assertEqual(image_blocks[0]["source"]["media_type"], "image/jpeg")

    @patch("image_agent.client")
    def test_returns_null_fallback_on_api_error(self, mock_client):
        # What:    Verifies that when the Anthropic API raises an error, the agent
        #          returns a null-filled result rather than propagating the exception.
        # Returns: None
        # Input:   mocked client raising an exception
        # Output:  ProductAnalysisResult with all fields null, reason contains "Agent error"

        mock_client.messages.create.side_effect = Exception("API unavailable")

        # str
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        # ProductAnalysisResult
        result = analyze_product_image(fake_base64, "image/jpeg")

        self.assertIsNone(result.name)
        self.assertIn("Agent error", result.reason)


if __name__ == "__main__":
    unittest.main()

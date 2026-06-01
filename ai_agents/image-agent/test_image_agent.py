import sys
sys.stdout.reconfigure(encoding="utf-8")

# test_image_agent.py
#
# Unit tests for the Image agent.
# Every function in image_agent.py has at least one test here.
# The Anthropic client and EasyOCR reader are mocked so no real API calls
# or OCR model loads occur during unit testing.

import base64
import json
import unittest
from unittest.mock import MagicMock, patch

from image_agent import (
    _call_claude_text,
    _decode_image_bytes,
    _extract_json_object,
    _extract_ocr_text,
    _extract_text_from_response,
    _parse_response,
    _strip_markdown_fences,
    analyze_product_image,
)
from image_config import IMAGE_USER_PROMPT


class TestDecodeImageBytes(unittest.TestCase):
    def test_decodes_base64_to_bytes(self):
        # What:    Verifies that a valid base64 string is decoded back to the original bytes.
        # Returns: None
        # Input:   base64.b64encode(b"hello") = "aGVsbG8="
        # Output:  b"hello"

        # str — base64 encoding of b"hello"
        encoded = base64.b64encode(b"hello").decode("utf-8")

        self.assertEqual(_decode_image_bytes(encoded), b"hello")


class TestExtractOcrText(unittest.TestCase):
    @patch("image_agent._ocr_reader")
    def test_joins_confident_fragments(self, mock_reader):
        # What:    Verifies that text fragments above the confidence threshold
        #          are joined into a single string.
        # Returns: None
        # Input:   OCR results with two high-confidence fragments
        # Output:  "Almarai 1L"

        # list[tuple] — mocked EasyOCR output: (bbox, text, confidence)
        mock_reader.readtext.return_value = [
            (None, "Almarai", 0.95),
            (None, "1L", 0.85),
        ]

        self.assertEqual(_extract_ocr_text(b"fake_bytes"), "Almarai 1L")

    @patch("image_agent._ocr_reader")
    def test_drops_low_confidence_fragments(self, mock_reader):
        # What:    Verifies that fragments below IMAGE_OCR_CONFIDENCE_THRESHOLD are excluded.
        # Returns: None
        # Input:   one confident fragment and one noise fragment (confidence 0.1)
        # Output:  only the confident fragment is included

        mock_reader.readtext.return_value = [
            (None, "Almarai", 0.95),
            (None, "@@##", 0.1),
        ]

        self.assertEqual(_extract_ocr_text(b"fake_bytes"), "Almarai")

    @patch("image_agent._ocr_reader")
    def test_returns_empty_string_when_no_detections(self, mock_reader):
        # What:    Verifies that an empty string is returned when OCR finds nothing.
        # Returns: None
        # Input:   empty OCR result list
        # Output:  ""

        mock_reader.readtext.return_value = []

        self.assertEqual(_extract_ocr_text(b"fake_bytes"), "")


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
        second_block.text = '  {"name": "Almarai"}  '

        # MagicMock
        mock_response = MagicMock()
        mock_response.content = [first_block, second_block]

        self.assertEqual(_extract_text_from_response(mock_response), '{"name": "Almarai"}')

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
        # Input:   '{"name": "Almarai"}'
        # Output:  '{"name": "Almarai"}'

        # str
        plain_json = '{"name": "Almarai"}'

        self.assertEqual(_strip_markdown_fences(plain_json), plain_json)


class TestExtractJsonObject(unittest.TestCase):
    def test_extracts_object_from_prose_prefix(self):
        # What:    Verifies that leading prose before the JSON object is stripped.
        # Returns: None
        # Input:   'Here is the info:\n{"name": "Almarai"}'
        # Output:  '{"name": "Almarai"}'

        self.assertEqual(
            _extract_json_object('Here is the info:\n{"name": "Almarai"}'),
            '{"name": "Almarai"}',
        )

    def test_plain_object_passes_through(self):
        # What:    Verifies that text already starting with '{' is returned unchanged.
        # Returns: None
        # Input:   '{"name": "Almarai"}'
        # Output:  '{"name": "Almarai"}'

        # str
        plain = '{"name": "Almarai"}'

        self.assertEqual(_extract_json_object(plain), plain)

    def test_returns_original_when_no_braces(self):
        # What:    Verifies that text with no braces is returned as-is so the caller
        #          receives a JSONDecodeError rather than a cryptic slice error.
        # Returns: None
        # Input:   "no braces here"
        # Output:  "no braces here"

        self.assertEqual(_extract_json_object("no braces here"), "no braces here")


class TestParseResponse(unittest.TestCase):
    def test_returns_product_result_on_valid_json(self):
        # What:    Verifies that _parse_response maps JSON fields to ProductAnalysisResult.
        # Returns: None
        # Input:   mocked response with valid product JSON
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

    def test_returns_null_fields_with_reason_on_unidentifiable(self):
        # What:    Verifies that a response with null fields and a reason string
        #          maps correctly to ProductAnalysisResult.
        # Returns: None
        # Input:   mocked response with null fields and reason text
        # Output:  ProductAnalysisResult with all product fields null, reason populated

        # dict
        null_json = {"name": None, "brand": None, "size": None, "reason": "OCR text unrecognisable"}

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
        self.assertEqual(result.reason, "OCR text unrecognisable")

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


class TestCallClaudeText(unittest.TestCase):
    @patch("image_agent.client")
    def test_sends_ocr_text_and_system_prompt(self, mock_client):
        # What:    Verifies that _call_claude_text passes the OCR text and system prompt
        #          to the Anthropic text API in the correct structure.
        # Returns: None
        # Input:   mocked client, ocr_text="Almarai Full Fat Milk 1L"
        # Output:  client.messages.create called once with correct model and message content

        mock_client.messages.create.return_value = MagicMock()

        _call_claude_text("Almarai Full Fat Milk 1L")

        # dict — the keyword arguments passed to messages.create
        call_kwargs = mock_client.messages.create.call_args.kwargs

        self.assertEqual(call_kwargs["model"], "claude-sonnet-4-6")
        # str — the user message text should contain both the prompt prefix and OCR text
        user_content = call_kwargs["messages"][0]["content"]
        self.assertIn("Almarai Full Fat Milk 1L", user_content)
        self.assertIn(IMAGE_USER_PROMPT, user_content)


class TestAnalyzeProductImage(unittest.TestCase):
    @patch("image_agent.client")
    @patch("image_agent._ocr_reader")
    def test_returns_product_result_on_success(self, mock_reader, mock_client):
        # What:    Verifies the full pipeline: OCR extracts text, Claude structures it,
        #          result is returned as ProductAnalysisResult.
        # Returns: None
        # Input:   mocked OCR returning "Lays Chips 165g", mocked Claude returning JSON
        # Output:  ProductAnalysisResult(name="Chips", brand="Lays", size="165g")

        mock_reader.readtext.return_value = [
            (None, "Lays", 0.95),
            (None, "Chips", 0.90),
            (None, "165g", 0.88),
        ]

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

        # str — fake base64 (any valid base64 works since OCR is mocked)
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        # ProductAnalysisResult
        result = analyze_product_image(fake_base64, "image/jpeg")

        self.assertEqual(result.name, "Chips")
        self.assertEqual(result.brand, "Lays")
        self.assertEqual(result.size, "165g")

    @patch("image_agent._ocr_reader")
    def test_returns_no_text_detected_when_ocr_is_empty(self, mock_reader):
        # What:    Verifies that when OCR finds no text, the agent returns a null result
        #          with reason "No text detected in image" without calling Claude at all.
        # Returns: None
        # Input:   mocked OCR returning empty results
        # Output:  ProductAnalysisResult with all fields null, reason="No text detected in image"

        mock_reader.readtext.return_value = []

        # str
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        # ProductAnalysisResult
        result = analyze_product_image(fake_base64, "image/jpeg")

        self.assertIsNone(result.name)
        self.assertEqual(result.reason, "No text detected in image")

    @patch("image_agent._ocr_reader")
    def test_returns_null_fallback_on_api_error(self, mock_reader):
        # What:    Verifies that when the Anthropic API raises an error, the agent
        #          returns a null-filled result rather than propagating the exception.
        # Returns: None
        # Input:   mocked OCR returning text, mocked client raising an exception
        # Output:  ProductAnalysisResult with all fields null, reason contains "Agent error"

        mock_reader.readtext.return_value = [(None, "Almarai", 0.9)]

        # str
        fake_base64 = base64.b64encode(b"fake_image").decode("utf-8")

        with patch("image_agent.client") as mock_client:
            mock_client.messages.create.side_effect = Exception("API unavailable")

            # ProductAnalysisResult
            result = analyze_product_image(fake_base64, "image/jpeg")

        self.assertIsNone(result.name)
        self.assertIn("Agent error", result.reason)


if __name__ == "__main__":
    unittest.main()

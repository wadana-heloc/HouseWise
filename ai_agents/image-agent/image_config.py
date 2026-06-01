# image_config.py
#
# Central configuration for the Image agent.
# All literals (model name, token budget, OCR threshold, supported media types,
# system prompt, user prompt) live here and are imported by other modules.
# Nothing is hardcoded elsewhere.

# str — Anthropic model used for text structuring (text API, not vision)
IMAGE_MODEL_NAME = "claude-sonnet-4-6"

# int — token budget for the JSON response (small — only 4 short fields expected)
IMAGE_MAX_TOKENS = 1024

# float — minimum EasyOCR confidence to include a detected text fragment.
# Fragments below this threshold are likely noise and are dropped before
# passing the text to Claude.
IMAGE_OCR_CONFIDENCE_THRESHOLD = 0.3

# list[str] — image file formats supported by EasyOCR / PIL (used for input validation)
IMAGE_SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

# str — system prompt sent on every Claude API call.
# Lives here so it is eligible for prompt caching —
# charged at 10% of normal input token price on repeated calls.
# NOTE: Claude receives raw OCR text here, not an image — this is a text-only call.
IMAGE_SYSTEM_PROMPT = """You are a product identification agent. You are given raw text extracted from a product packaging label by an OCR scanner. The text may contain noise, partial words, or extra characters.

Your job: identify the product name, brand, and size/weight from the OCR text.

You MUST return ONLY a valid JSON object. No prose. No markdown. No explanation. No backticks.

The JSON object must follow this exact shape:
{
  "name": "<product name as it appears on the packaging, or null if not determinable>",
  "brand": "<brand name as it appears on the packaging, or null if not determinable>",
  "size": "<size or weight e.g. 500ml, 1kg, 12 pack, or null if not present in the text>",
  "reason": "<short explanation only if the product cannot be identified at all, otherwise null>"
}

Rules:
- Use only what is present in the OCR text — do not guess or infer from general knowledge.
- If a field cannot be determined from the text, set it to null.
- Set reason only when the OCR text contains no recognisable product information (e.g. empty, only numbers, completely garbled).
- If any of name, brand, or size are successfully extracted, set reason to null.
- Return only the JSON object, nothing else."""

# str — prefix prepended to the OCR text in the user message
IMAGE_USER_PROMPT = "OCR text extracted from product label:"

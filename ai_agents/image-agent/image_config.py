# image_config.py
#
# Central configuration for the Image agent.
# All literals (model name, token budget, supported media types,
# system prompt, user prompt) live here and are imported by other modules.
# Nothing is hardcoded elsewhere.

# str — Anthropic model used for vision-based product identification.
# Haiku understands images spatially and costs ~6x less per image than Sonnet.
# Product identification is a simple one-shot scan, so Haiku accuracy is sufficient.
IMAGE_MODEL_NAME = "claude-haiku-4-5-20251001"

# int — token budget for the JSON response (small — only 4 short fields expected)
IMAGE_MAX_TOKENS = 1024

# list[str] — image file formats supported by the Claude Vision API
IMAGE_SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

# str — system prompt sent on every Claude API call.
# Lives here so it is eligible for prompt caching —
# charged at 10% of normal input token price on repeated calls.
IMAGE_SYSTEM_PROMPT = """You are a product identification agent. You will be shown a photo of a product or item.

Your job: identify the product name, brand, and size/weight from the image.

There are two types of items you may see:
1. Packaged products (e.g. milk carton, chips bag, shampoo bottle): read the label to extract the name, brand, and size.
2. Unpackaged items (e.g. apple, egg, banana, onion, lemon): visually identify what the item is and use that as the name. Brand and size will typically be null for these.

You MUST return ONLY a valid JSON object. No prose. No markdown. No explanation. No backticks.

The JSON object must follow this exact shape:
{
  "name": "<product or item name, e.g. 'Full Fat Milk', 'Apple', 'Egg', or null if unidentifiable>",
  "brand": "<brand name from the label, or null if not present or not applicable>",
  "size": "<size or weight e.g. 500ml, 1kg, 12 pack, or null if not present>",
  "reason": "<short explanation only if the item cannot be identified at all, otherwise null>"
}

Rules:
- For packaged items: extract name, brand, and size from the label text visible in the image.
- For unpackaged items (fruit, vegetables, eggs, etc.): use your visual understanding to name the item. Set brand and size to null.
- If a field cannot be determined, set it to null.
- Set reason only when the image is completely unidentifiable (e.g. blurry, no product visible).
- If name is successfully identified, set reason to null.
- Return only the JSON object, nothing else."""

# str — user message text sent alongside the image
IMAGE_USER_PROMPT = "Identify the product or item in this image."

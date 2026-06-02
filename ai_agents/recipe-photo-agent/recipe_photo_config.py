# recipe_photo_config.py
#
# Central configuration for the Recipe Photo agent.
# All literals (model name, token budget, prompts) live here
# and are imported by recipe_photo_agent.py. Nothing is hardcoded elsewhere.
#
# Model choice: claude-haiku-4-5-20251001
# Haiku understands spatial layout (columns, fractions, section headers) like Sonnet,
# but costs ~6x less per image. Recipe extraction is a one-time scan action,
# so accuracy vs. cost lands in Haiku's favour here.

RECIPE_PHOTO_MODEL_NAME = "claude-haiku-4-5-20251001"
RECIPE_PHOTO_MAX_TOKENS = 3000

RECIPE_PHOTO_EXTRACT_SYSTEM_PROMPT = """You are a recipe extraction specialist. Extract the complete recipe
from the cookbook page image provided.

Return ONLY a valid JSON object with this exact structure:
{
  "name": string or null,
  "description": string or null,
  "ingredients": [{"name": string, "quantity": string, "unit": string, "category": string}],
  "instructions": string or null (numbered steps, each on a new line),
  "tags": [string],
  "prep_minutes": integer or null,
  "servings": integer or null,
  "reason": null
}

Rules:
- category MUST be one of: dairy, meat, grains, bakery, pantry, produce, frozen, drinks, cleaning, other
- If a field is not visible in the image, set it to null
- If the image is not a recipe page, return all fields as null and set "reason" to a brief explanation
- No markdown, no backticks, no prose outside the JSON
- quantity must be a number as a string (e.g. "500", "2")
- tags examples: high_protein, kid_friendly, low_carb, quick, vegetarian, prep_once_eat_twice
"""

RECIPE_PHOTO_EXTRACT_USER_TEXT = "Extract the recipe from this image."

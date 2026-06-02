import sys
sys.stdout.reconfigure(encoding="utf-8")

# cookbook_agent.py
#
# Core logic for the Cookbook agent.
# Exposes two public entry points the backend calls:
#   generate_recipe()                — generates a full recipe from a prompt and household context
#   personalize_recipe_description() — writes a member-tailored description of an existing recipe

import json

import anthropic
from dotenv import load_dotenv

load_dotenv()

from cookbook_config import (
    COOKBOOK_GENERATE_MAX_TOKENS,
    COOKBOOK_GENERATE_SYSTEM_PROMPT,
    COOKBOOK_MODEL_NAME,
    COOKBOOK_PERSONALIZE_MAX_TOKENS,
    COOKBOOK_PERSONALIZE_SYSTEM_PROMPT,
)
from cookbook_schemas import GeneratedRecipe

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()


def _extract_text_from_response(response: anthropic.types.Message) -> str:
    # What:    Walks the response content blocks and returns the last text block.
    #          The model may emit multiple content blocks; we always want the final text.
    # Returns: str — the raw text of the last text block, stripped of whitespace
    # Input:   response=<anthropic Message with a text block containing JSON>
    # Output:  '{"name": "Hidden Veggie Protein Pasta", ...}'

    # str
    last_text_content = ""

    for content_block in response.content:
        if content_block.type == "text":
            last_text_content = content_block.text.strip()

    return last_text_content


def _strip_markdown_fences(raw_text: str) -> str:
    # What:    Removes accidental markdown code fences from the model output.
    #          The system prompt forbids them, but this acts as a safety net.
    #          Uses split-on-newline + rsplit so backticks inside JSON content
    #          (e.g. a recipe name containing backticks) never break extraction.
    # Returns: str — cleaned text with no leading/trailing backtick fences
    # Input:   "```json\n{...}\n```"
    # Output:  "{...}"

    if not raw_text.startswith("```"):
        return raw_text

    # str — drop the opening ```json line by splitting on the first newline only
    content_after_opening_fence = raw_text.split("\n", 1)[-1]

    # str — drop everything from the last ``` onward (the closing fence)
    return content_after_opening_fence.rsplit("```", 1)[0].strip()


def _extract_json_object(text: str) -> str:
    # What:    Extracts the JSON object substring from text that may contain
    #          leading prose. Finds the first '{' and last '}' and returns only
    #          what is between them.
    # Returns: str — the raw JSON object substring, or the original text if no braces found
    # Input:   'Here is the recipe:\n{"name": "Pasta"}'
    # Output:  '{"name": "Pasta"}'

    # int
    object_start_index = text.find("{")
    # int
    object_end_index = text.rfind("}")

    if object_start_index == -1 or object_end_index == -1:
        return text

    return text[object_start_index : object_end_index + 1]


def generate_recipe(prompt: str, household_context: dict) -> dict:
    # What:    Generates a complete recipe based on a text prompt and household member profiles.
    #          Sends the prompt and member preferences to Claude, which returns a structured
    #          JSON recipe tailored to the household's taste and health goals.
    # Returns: dict — a GeneratedRecipe with name, description, ingredients, instructions,
    #          tags, prep_minutes, servings, and reason (null on success, error string on failure)
    # Input:   prompt="A high-protein pasta kids will eat",
    #          household_context={"prompt": ..., "tag_hints": [...], "household_members": [...]}
    # Output:  {"name": "Hidden Veggie Protein Pasta", "description": "...", "ingredients": [...], ...}

    try:
        # str — serialize the full request so Claude receives structured, unambiguous input
        user_payload_json = json.dumps(
            {"prompt": prompt, "household_context": household_context},
            ensure_ascii=False,
        )

        # anthropic.types.Message
        response = client.messages.create(
            model=COOKBOOK_MODEL_NAME,
            max_tokens=COOKBOOK_GENERATE_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": COOKBOOK_GENERATE_SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": user_payload_json,
                        },
                    ],
                }
            ],
        )

        # str — step 1: extract last text block from the response
        raw_response_text = _extract_text_from_response(response)

        # str — step 2: strip markdown fences if model disobeyed the system prompt
        fence_stripped_text = _strip_markdown_fences(raw_response_text)

        # str — step 3: extract JSON object by slicing from first '{' to last '}'
        cleaned_response_text = _extract_json_object(fence_stripped_text)

        # dict
        parsed_data = json.loads(cleaned_response_text)

        return GeneratedRecipe(**parsed_data).model_dump()

    except Exception as agent_error:
        return GeneratedRecipe(reason=f"Agent error: {agent_error}").model_dump()


def personalize_recipe_description(
    recipe: dict,
    member_profile: dict,
    recent_history: list[dict],
) -> str:
    # What:    Writes a personalized 2-4 sentence description of a recipe for one
    #          specific household member. Tailors language to age group, health goals,
    #          taste preferences, and recent eating history.
    # Returns: str — plain text description (no JSON, no markdown). Empty string on failure.
    # Input:   recipe={"name": "Chicken Curry", "ingredients": [...], ...},
    #          member_profile={"display_name": "Ahmed", "age_group": "kid", ...},
    #          recent_history=[{"recipe_name": "Chicken Curry", "eaten_on": "2026-05-25", "reaction": "loved"}]
    # Output:  "This dish is packed with hidden goodness and a flavour you'll love..."

    try:
        # str — serialize all context so Claude has full member and recipe information
        user_payload_json = json.dumps(
            {
                "recipe": recipe,
                "member_profile": member_profile,
                "recent_history": recent_history,
            },
            ensure_ascii=False,
        )

        # anthropic.types.Message
        response = client.messages.create(
            model=COOKBOOK_MODEL_NAME,
            max_tokens=COOKBOOK_PERSONALIZE_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": COOKBOOK_PERSONALIZE_SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": user_payload_json,
                        },
                    ],
                }
            ],
        )

        # str — plain text response; no JSON parsing needed for personalization
        return _extract_text_from_response(response)

    except Exception:
        return ""

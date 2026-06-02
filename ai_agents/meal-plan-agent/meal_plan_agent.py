import sys
sys.stdout.reconfigure(encoding="utf-8")

# meal_plan_agent.py
#
# Core logic for the Meal Plan agent.
# Exposes one public entry point the backend calls:
#   generate_weekly_plan() — generates a 7-day dinner plan for a household
#
# Design decisions reflected in the context payload:
#   - available_recipes sends ingredient_categories (not full ingredients) so Claude
#     can order meals by perishability without token bloat
#   - last_week_meals prevents repeating the same recipes week after week
#   - suggested_ingredients in the output covers invented meals for shopping list population;
#     cookbook recipe ingredients are looked up by the backend from the database

import json

import anthropic
from dotenv import load_dotenv

load_dotenv()

from meal_plan_config import (
    MEAL_PLAN_MAX_TOKENS,
    MEAL_PLAN_MODEL_NAME,
    MEAL_PLAN_SYSTEM_PROMPT,
)
from meal_plan_schemas import WeeklyPlanResult

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()


def _extract_text_from_response(response: anthropic.types.Message) -> str:
    # What:    Walks the response content blocks and returns the last text block.
    #          The model may emit multiple content blocks; we always want the final text.
    # Returns: str — the raw text of the last text block, stripped of whitespace
    # Input:   response=<anthropic Message with a text block containing JSON>
    # Output:  '{"ai_summary": "...", "days": [...]}'

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
    #          never break extraction.
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
    # Input:   'Here is the plan:\n{"ai_summary": "..."}'
    # Output:  '{"ai_summary": "..."}'

    # int
    object_start_index = text.find("{")
    # int
    object_end_index = text.rfind("}")

    if object_start_index == -1 or object_end_index == -1:
        return text

    return text[object_start_index : object_end_index + 1]


def generate_weekly_plan(context: dict) -> dict:
    # What:    Generates a 7-day dinner plan for a household based on member submissions.
    #          Sends a trimmed context to Claude — recipes include ingredient_categories
    #          (not full ingredient lists) so Claude can order by perishability efficiently.
    #          last_week_meals prevents recipe repetition across consecutive weeks.
    # Returns: dict — a WeeklyPlanResult with ai_summary, days (exactly 7), and reason
    #          (null on success, error string on failure)
    # Input:   context={week_start, household_members, available_recipes,
    #                   low_stock_items, last_week_meals}
    # Output:  {"ai_summary": "...", "days": [{day_of_week, recipe_id, meal_name,
    #           prep_label, notes, suggested_ingredients}, ...x7], "reason": null}

    try:
        # str — serialize the full context so Claude receives structured, unambiguous input
        user_payload_json = json.dumps(context, ensure_ascii=False)

        # anthropic.types.Message
        response = client.messages.create(
            model=MEAL_PLAN_MODEL_NAME,
            max_tokens=MEAL_PLAN_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": MEAL_PLAN_SYSTEM_PROMPT,
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

        return WeeklyPlanResult(**parsed_data).model_dump()

    except Exception as agent_error:
        return WeeklyPlanResult(reason=f"Agent error: {agent_error}").model_dump()

# price_agent.py
#
# Core logic for the Price agent.
# Exposes search_grocery_prices() — the public entry point the backend calls.
# Handles prompt building, batching, API calls, JSON parsing, and error fallback.

import json

import anthropic

from price_config import PRICE_BATCH_SIZE, PRICE_MODEL_NAME, PRICE_SYSTEM_PROMPT, PRICE_TOKENS_MAXIMUM

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()


def build_user_prompt(items: list[str], stores: list[str]) -> str:
    # What:    Builds a natural, conversational prompt — the same way a user would
    #          ask on claude.ai. No URL-scraping instructions, no technical constraints.
    #          The model searches Google freely and finds prices from whatever source
    #          mentions these stores (aggregators, comparison sites, search snippets).
    #          The JSON schema lives in PRICE_SYSTEM_PROMPT so it is cached.
    # Returns: str — a short natural-language prompt
    # Input:   items=["eggs 12pcs"], stores=["https://www.carrefouruae.com"]
    # Output:  "What are the current prices in AED of eggs 12pcs at these UAE stores?..."

    # str
    stores_formatted = "\n".join(
        f"- {store_url.replace('https://www.', '').replace('https://', '')}"
        for store_url in stores
    )

    # str
    items_formatted = ", ".join(items)

    return f"""What are the current prices in AED of {items_formatted} at these UAE stores?
{stores_formatted}

Map each price you find to the matching store URL in the output JSON."""


def _compute_summary_fields(result: dict) -> dict:
    # What:    Derives cheapest_store_url, cheapest_price, best_value_store_url,
    #          best_value_unit_price, and best_value_unit from the prices array
    #          in Python — not the model — so the calculation is always deterministic
    #          and null-safe. Falls back to cheapest raw price store when no unit
    #          prices are available.
    # Returns: dict — the original result dict with the five summary fields added
    # Input:   result={"item": "milk 1L", "prices": [{"store_url": "...", "price": 5.5, ...}]}
    # Output:  {"item": "milk 1L", "prices": [...], "cheapest_store_url": "...", "cheapest_price": 5.5, ...}

    # list[dict]
    prices = result.get("prices", [])

    # list[tuple[float, str]]
    valid_raw = [(p["price"], p["store_url"]) for p in prices if p.get("price") is not None]

    if valid_raw:
        # float, str
        cheapest_price, cheapest_store_url = min(valid_raw)
    else:
        # float or None, str or None
        cheapest_price, cheapest_store_url = None, None

    # list[tuple[float, str, str or None]]
    valid_unit = [
        (p["unit_price"], p["store_url"], p.get("unit"))
        for p in prices
        if p.get("unit_price") is not None
    ]

    if valid_unit:
        # float, str, str or None
        best_unit_price, best_value_store_url, best_value_unit = min(valid_unit)
    else:
        # no unit prices available — fall back to cheapest raw price store
        # float or None
        best_unit_price = None
        # str or None
        best_value_store_url = cheapest_store_url
        # str or None
        best_value_unit = None

    return {
        **result,
        "cheapest_store_url": cheapest_store_url,
        "cheapest_price": cheapest_price,
        "best_value_store_url": best_value_store_url,
        "best_value_unit_price": best_unit_price,
        "best_value_unit": best_value_unit,
    }


def _build_null_result_for_item(item: str, stores: list[str]) -> dict:
    # What:    Builds a null-filled result dict for a single item.
    #          Used by the error fallback when JSON parsing fails so the
    #          caller always receives a consistent shape regardless of errors.
    # Returns: dict — a result entry with all price and summary fields set to None
    # Input:   item="milk 1L", stores=["https://www.carrefouruae.com"]
    # Output:  {"item": "milk 1L", "prices": [...nulls...], "cheapest_store_url": None, ...}

    # list[dict]
    null_prices = [
        {
            "store_url": store_url,
            "store_name": store_url,
            "price": None,
            "currency": "AED",
            "product_url": None,
            "product_name_as_found": None,
            "unit_price": None,
            "unit": None,
        }
        for store_url in stores
    ]

    return {
        "item": item,
        "prices": null_prices,
        "cheapest_store_url": None,
        "cheapest_price": None,
        "best_value_store_url": None,
        "best_value_unit_price": None,
        "best_value_unit": None,
    }


def _extract_text_from_response(response: anthropic.types.Message) -> str:
    # What:    Walks the response content blocks and returns the last text block.
    #          The model emits tool_use blocks while searching, then a final text
    #          block with the JSON answer. We scan all blocks and keep overwriting
    #          so we always end up with the last text.
    # Returns: str — the raw text content of the final text block, stripped of whitespace
    # Input:   response=<anthropic Message with tool_use blocks followed by a text block>
    # Output:  '[{"item": "milk 1L", ...}]'

    # str
    last_text_content = ""

    for content_block in response.content:
        if content_block.type == "text":
            last_text_content = content_block.text.strip()

    return last_text_content


def _strip_markdown_fences(raw_text: str) -> str:
    # What:    Removes accidental markdown code fences from the model output.
    #          The system prompt forbids them, but this acts as a safety net
    #          in case the model wraps the JSON in ```json ... ``` anyway.
    # Returns: str — cleaned text with no leading/trailing backtick fences
    # Input:   "```json\n[{...}]\n```"
    # Output:  "[{...}]"

    if not raw_text.startswith("```"):
        return raw_text

    # str — everything after the opening fence line
    content_after_opening_fence = raw_text.split("```")[1]

    if content_after_opening_fence.startswith("json"):
        content_after_opening_fence = content_after_opening_fence[4:]

    return content_after_opening_fence.strip()


def _extract_json_array(text: str) -> str:
    # What:    Extracts the JSON array substring from text that may contain
    #          leading prose. Models often prepend an explanation before the
    #          JSON array even when the system prompt forbids it. We find the
    #          first '[' and last ']' and return only what is between them.
    # Returns: str — the raw JSON array substring, or the original text if no brackets found
    # Input:   "Based on my search...\n[{\"item\": \"milk\"}]"
    # Output:  '[{"item": "milk"}]'

    # int
    array_start_index = text.find("[")
    # int
    array_end_index = text.rfind("]")

    if array_start_index == -1 or array_end_index == -1:
        return text

    return text[array_start_index : array_end_index + 1]


def _call_agent(items: list[str], stores: list[str]) -> list[dict]:
    # What:    Makes a single Anthropic API call for the given items and stores.
    #          Passes the system prompt as a cacheable content block so repeated
    #          calls reuse the cached prompt at 10% of normal input token cost.
    #          Runs the JSON cleaning pipeline on the response, then delegates
    #          summary field computation to _compute_summary_fields.
    #          Falls back to null-filled results if the model returns unparseable text.
    # Returns: list[dict] — one dict per item with price data and computed summary fields
    # Input:   items=["milk 1L"], stores=["https://www.carrefouruae.com"]
    # Output:  [{"item": "milk 1L", "prices": [...], "cheapest_store_url": "...", "cheapest_price": 5.5}]

    # anthropic.types.Message
    response = client.messages.create(
        model=PRICE_MODEL_NAME,
        max_tokens=PRICE_TOKENS_MAXIMUM,
        system=[
            {
                "type": "text",
                "text": PRICE_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[
            {"role": "user", "content": build_user_prompt(items, stores)}
        ],
    )

    # str
    raw_response_text = _extract_text_from_response(response)

    # str
    fence_stripped_text = _strip_markdown_fences(raw_response_text)

    # str
    cleaned_response_text = _extract_json_array(fence_stripped_text)

    try:
        # list[dict]
        parsed = json.loads(cleaned_response_text)
        return [_compute_summary_fields(r) for r in parsed]
    except json.JSONDecodeError:
        return [_build_null_result_for_item(item, stores) for item in items]


def search_grocery_prices(items: list[str], stores: list[str]) -> list[dict]:
    # What:    Public entry point for the price agent.
    #          Splits large item lists into batches of PRICE_BATCH_SIZE to stay
    #          within token limits, calls _call_agent for each batch, then merges
    #          all results into a single flat list.
    # Returns: list[dict] — one dict per item with price data across all stores
    # Input:   items=["milk 1L", "eggs 12pcs", ...], stores=["https://www.carrefouruae.com", ...]
    # Output:  [{"item": "milk 1L", ...}, {"item": "eggs 12pcs", ...}]

    if len(items) <= PRICE_BATCH_SIZE:
        return _call_agent(items, stores)

    # list[dict]
    all_results = []

    for batch_start_index in range(0, len(items), PRICE_BATCH_SIZE):
        # list[str]
        current_batch = items[batch_start_index : batch_start_index + PRICE_BATCH_SIZE]
        all_results.extend(_call_agent(current_batch, stores))

    return all_results

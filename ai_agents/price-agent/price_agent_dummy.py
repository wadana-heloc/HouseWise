# price_agent_dummy.py
#
# Drop-in replacement for price_agent.py for local testing.
# Uses claude-haiku (no web search) to generate plausible fake AED prices.
# Same search_grocery_prices() signature — swap the import in the backend to use this.

import json

import anthropic

from price_agent import (
    _build_null_result_for_item,
    _compute_summary_fields,
    _extract_json_array,
    _strip_markdown_fences,
)
from price_config import PRICE_BATCH_SIZE

DUMMY_MODEL = "claude-haiku-4-5-20251001"

client = anthropic.Anthropic()

_DUMMY_SYSTEM_PROMPT = """You are a mock grocery price generator for UAE supermarket testing.
Generate plausible but fictional AED prices for grocery items across UAE stores.
Use realistic UAE price ranges (e.g. milk 1L: 5–8 AED, eggs 12pcs: 10–18 AED, rice 5kg: 25–45 AED).
Vary prices slightly between stores so comparisons are interesting.
Every store in the input must appear in every item's prices array.
Return ONLY a valid JSON array. No prose, no markdown, no backticks.

JSON shape — one element per item:
{
  "item": "<item name as passed in>",
  "prices": [
    {
      "store_url": "<store URL from input>",
      "store_name": "<short store name derived from the URL>",
      "price": <realistic AED number>,
      "currency": "AED",
      "product_url": null,
      "product_name_as_found": "<plausible product name>",
      "unit_price": <AED per unit as a number, or null>,
      "unit": "<AED/100ml | AED/kg | AED/piece | AED/100g | null>"
    }
  ]
}"""


def _dummy_user_prompt(items: list[str], stores: list[str]) -> str:
    stores_formatted = "\n".join(f"- {s}" for s in stores)
    return (
        f"Generate fake but realistic AED prices for: {', '.join(items)}\n\n"
        f"Stores:\n{stores_formatted}\n\n"
        "Return one JSON array element per item. Every store must appear in every prices array."
    )


def _call_dummy_agent(items: list[str], stores: list[str]) -> list[dict]:
    response = client.messages.create(
        model=DUMMY_MODEL,
        max_tokens=2048,
        system=_DUMMY_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _dummy_user_prompt(items, stores)}],
    )

    raw = ""
    for block in response.content:
        if block.type == "text":
            raw = block.text.strip()

    cleaned = _extract_json_array(_strip_markdown_fences(raw))

    try:
        parsed = json.loads(cleaned)
        return [_compute_summary_fields(r) for r in parsed]
    except json.JSONDecodeError:
        return [_build_null_result_for_item(item, stores) for item in items]


def search_grocery_prices(items: list[str], stores: list[str]) -> list[dict]:
    if len(items) <= PRICE_BATCH_SIZE:
        return _call_dummy_agent(items, stores)

    all_results = []
    for i in range(0, len(items), PRICE_BATCH_SIZE):
        all_results.extend(_call_dummy_agent(items[i : i + PRICE_BATCH_SIZE], stores))
    return all_results

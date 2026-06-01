# Grocery Price Search Agent

## What You Are Building

A single Python function `search_grocery_prices(items: list[str], stores: list[str]) -> list[dict]` that calls the Anthropic API with the web search tool to find the price of each grocery item across a list of UAE supermarket URLs, then returns a structured list the backend can store in the database.

---

## Function Signature

```python
def search_grocery_prices(items: list[str], stores: list[str]) -> list[dict]:
    ...
```

**Input:**
- `items` — list of grocery item strings, e.g. `["milk 1L", "eggs 12pcs", "basmati rice 5kg"]`
- `stores` — list of store URLs, e.g. `["https://www.carrefouruae.com", "https://www.spinneys.com", "https://www.unioncoop.com", "https://www.luluhypermarket.com"]`

**Output:** `list[dict]` — see Output Schema section below.

---

## Dependencies

```
anthropic>=0.25.0
```

No other dependencies needed. Do not use requests, BeautifulSoup, or any scraping library.

---

## Implementation

### API Setup

```python
import anthropic
import json

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env
```

### System Prompt

Keep this tight — no fluff. The system prompt must instruct the model to return ONLY raw JSON, nothing else.

```python
SYSTEM_PROMPT = """You are a grocery price search agent for UAE supermarkets.
Your job: find the current price (in AED) of grocery items across given stores.
Use web search efficiently — batch items per search query, search UAE aggregator sites first, then individual stores.
You MUST return ONLY a valid JSON array. No prose. No markdown. No explanation. No backticks.
If a price is not found for a store, use null.
Always include the actual product URL where the price was found."""
```

### User Prompt Template

```python
def build_user_prompt(items: list[str], stores: list[str]) -> str:
    stores_list = "\n".join(f"- {s}" for s in stores)
    items_list = ", ".join(items)
    return f"""Find prices in AED for these grocery items: {items_list}

Across these stores:
{stores_list}

Search smartly — use UAE grocery comparison sites first, then store-specific searches.
Batch your searches (multiple items per query) to be efficient.

Return a JSON array where each element has this exact shape:
{{
  "item": "<item name>",
  "prices": [
    {{
      "store_url": "<store url from the list>",
      "store_name": "<short store name>",
      "price": <number or null>,
      "currency": "AED",
      "product_url": "<url where price was found or null>",
      "product_name_as_found": "<exact product name as found or null>"
    }}
  ],
  "cheapest_store_url": "<store_url with lowest non-null price or null>",
  "cheapest_price": <lowest non-null price or null>
}}

The array must have one element per item. Every store must appear in every item's prices array."""
```

### API Call

```python
def search_grocery_prices(items: list[str], stores: list[str]) -> list[dict]:
    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[
            {"role": "user", "content": build_user_prompt(items, stores)}
        ]
    )

    # Extract the final text block (last assistant message after tool loop)
    result_text = ""
    for block in response.content:
        if block.type == "text":
            result_text = block.text.strip()

    # Strip accidental markdown fences if model misbehaves
    if result_text.startswith("```"):
        result_text = result_text.split("```")[1]
        if result_text.startswith("json"):
            result_text = result_text[4:]
    result_text = result_text.strip()

    return json.loads(result_text)
```

---

## Output Schema

Each element in the returned list:

```json
{
  "item": "milk 1L",
  "prices": [
    {
      "store_url": "https://www.carrefouruae.com",
      "store_name": "Carrefour UAE",
      "price": 5.50,
      "currency": "AED",
      "product_url": "https://www.carrefouruae.com/...",
      "product_name_as_found": "Almarai Full Fat Milk 1L"
    },
    {
      "store_url": "https://www.spinneys.com",
      "store_name": "Spinneys",
      "price": null,
      "currency": "AED",
      "product_url": null,
      "product_name_as_found": null
    }
  ],
  "cheapest_store_url": "https://www.carrefouruae.com",
  "cheapest_price": 5.50
}
```

---

## Token Optimization Rules

These are the key decisions that keep token usage low. Do not change them without good reason.

1. **One API call for all items** — all items are sent in a single `messages.create` call. The model uses the tool_use loop internally. Never loop over items and call the API once per item.

2. **System prompt is instruction-only** — no examples, no JSON schema examples in the system prompt. The schema lives only in the user prompt, once.

3. **JSON-only output** — the system prompt explicitly forbids prose. This eliminates all explanation tokens from the response.

4. **Model handles search strategy** — do not tell the model how many searches to run. It will batch intelligently. Constraining it forces more tool calls.

5. **max_tokens: 4096** — sufficient for 20–30 items across 4–5 stores. Increase only if items list grows beyond ~40 items.

6. **No conversation history** — this is a stateless single-turn call. No prior messages passed.

---

## Batching Large Lists

If `len(items) > 30`, split into batches of 15 and merge results:

```python
def search_grocery_prices(items: list[str], stores: list[str]) -> list[dict]:
    BATCH_SIZE = 15
    if len(items) <= BATCH_SIZE:
        return _call_agent(items, stores)
    
    results = []
    for i in range(0, len(items), BATCH_SIZE):
        batch = items[i:i + BATCH_SIZE]
        results.extend(_call_agent(batch, stores))
    return results

def _call_agent(items: list[str], stores: list[str]) -> list[dict]:
    # ... the implementation above
```

---

## Error Handling

```python
try:
    return json.loads(result_text)
except json.JSONDecodeError:
    # Return nulls for all items — backend handles gracefully
    return [
        {
            "item": item,
            "prices": [
                {"store_url": s, "store_name": s, "price": None,
                 "currency": "AED", "product_url": None, "product_name_as_found": None}
                for s in stores
            ],
            "cheapest_store_url": None,
            "cheapest_price": None
        }
        for item in items
    ]
```

---

## Environment Variable

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

The `anthropic.Anthropic()` client reads this automatically. Do not hardcode the key.

---

## What This Agent Does NOT Do

- It does not store anything — storage is the backend's responsibility.
- It does not generate meal plans or reports — that is a separate agent.
- It does not maintain conversation history — fully stateless.
- It does not validate whether a store URL is valid — pass correct URLs from the backend.

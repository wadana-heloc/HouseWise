import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

import json
import anthropic
from price_config import PRICE_MODEL_NAME, PRICE_SYSTEM_PROMPT, PRICE_TOKENS_MINIMUM
from price_agent import build_user_prompt

client = anthropic.Anthropic()

items = ["Basmati Rice", "Cucumber", "Mozzarella Cheese (shredded)"]
stores = [
    "https://www.spinneys.com",
    "https://www.carrefouruae.com",
    "https://www.unioncoop.com",
    "https://www.luluhypermarket.com",
]

print(f"Running: {len(items)} items × {len(stores)} stores")
print(f"Items: {items}")
print()

response = client.messages.create(
    model=PRICE_MODEL_NAME,
    max_tokens=PRICE_TOKENS_MINIMUM,
    system=[{"type": "text", "text": PRICE_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    tools=[{"type": "web_search_20250305", "name": "web_search"}],
    messages=[{"role": "user", "content": build_user_prompt(items, stores)}],
)

print("=== USAGE ===")
print(response.usage)
print()

# extract and print results
result_text = ""
for block in response.content:
    if block.type == "text":
        result_text = block.text.strip()

if result_text.startswith("```"):
    result_text = result_text.split("```")[1]
    if result_text.startswith("json"):
        result_text = result_text[4:]
result_text = result_text.strip()
start = result_text.find("[")
end = result_text.rfind("]")
if start != -1 and end != -1:
    result_text = result_text[start:end+1]

try:
    results = json.loads(result_text)
    print("=== RESULTS ===")
    for entry in results:
        print(f"\n{entry['item']} - cheapest: {entry['cheapest_price']} AED at {entry['cheapest_store_url']}")
        for p in entry["prices"]:
            print(f"  {p['store_name']}: {p['price']} AED")
except json.JSONDecodeError as e:
    print(f"JSON parse error: {e}")
    print("Raw response:", result_text[:500])

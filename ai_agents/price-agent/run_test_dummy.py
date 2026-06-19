import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from price_config import STORE_URLS
from price_agent_dummy import search_grocery_prices

items = ["Kinder Bueno", "Milk 1L", "Eggs 12pcs", "Basmati Rice 5kg"]

print(f"[DUMMY] {len(items)} items × {len(STORE_URLS)} stores  (Haiku, no web search)")
print(f"Items: {items}")
print()

results = search_grocery_prices(items, STORE_URLS)

print("=== DUMMY RESULTS ===")
for entry in results:
    print(f"\n{entry['item']}")
    print(f"  cheapest raw price : {entry['cheapest_price']} AED  at {entry['cheapest_store_url']}")
    print(f"  best value per unit: {entry['best_value_unit_price']} {entry['best_value_unit']}  at {entry['best_value_store_url']}")
    print(f"  {'Store':<25} {'Price':>10}  {'Unit Price':>12}  {'Unit':<14}  {'Product'}")
    print(f"  {'-'*25}  {'-'*9}  {'-'*11}  {'-'*13}  {'-'*40}")
    for p in entry["prices"]:
        price_str = f"{p['price']:.2f} AED" if p["price"] is not None else "n/a"
        unit_price_str = f"{p['unit_price']:.4f}" if p["unit_price"] is not None else "n/a"
        unit_str = p["unit"] or "n/a"
        product_str = (p["product_name_as_found"] or "n/a")[:40]
        print(f"  {p['store_name']:<25} {price_str:>10}  {unit_price_str:>12}  {unit_str:<14}  {product_str}")

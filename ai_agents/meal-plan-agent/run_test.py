import sys
sys.stdout.reconfigure(encoding="utf-8")

# run_test.py
#
# Smoke test for the Meal Plan agent using a real API call.
# Uses a realistic household scenario with two members, available recipes,
# busy days, meal requests, low stock items, and last week's meals.

import os

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from meal_plan_agent import generate_weekly_plan

# dict — full household context matching the revised payload design
context = {
    "week_start": "2026-06-08",
    "household_members": [
        {
            "display_name": "Nour",
            "age_group": "adult",
            "taste_preferences": "loves spicy food",
            "health_preferences": {
                "high_protein": True,
                "low_calories": False,
                "low_carbs": False,
                "low_sugar": False,
                "whole_grain": False,
            },
            "busy_days": [2, 4],   # Tuesday and Thursday are busy
            "meal_requests": [
                {"description": "I want a spicy beef dish", "recipe_id": None}
            ],
        },
        {
            "display_name": "Ahmed",
            "age_group": "kid",
            "taste_preferences": "hates vegetables, loves cheese and pasta",
            "health_preferences": {
                "high_protein": False,
                "low_calories": False,
                "low_carbs": False,
                "low_sugar": True,
                "whole_grain": False,
            },
            "busy_days": [],
            "meal_requests": [
                {"description": "I want burgers", "recipe_id": None}
            ],
        },
    ],
    "available_recipes": [
        {
            "id": "uuid-salmon",
            "name": "Grilled Salmon with Veggies",
            "tags": ["high_protein", "quick"],
            "prep_minutes": 20,
            "ingredient_categories": ["meat", "produce", "pantry"],
        },
        {
            "id": "uuid-curry",
            "name": "Chicken Curry",
            "tags": ["high_protein", "prep_once_eat_twice"],
            "prep_minutes": 45,
            "ingredient_categories": ["meat", "dairy", "produce", "pantry"],
        },
        {
            "id": "uuid-pasta",
            "name": "Creamy Chicken Pasta",
            "tags": ["kid_friendly", "quick"],
            "prep_minutes": 30,
            "ingredient_categories": ["meat", "dairy", "grains", "pantry"],
        },
        {
            "id": "uuid-lentil",
            "name": "Red Lentil Soup",
            "tags": ["vegetarian", "prep_once_eat_twice"],
            "prep_minutes": 35,
            "ingredient_categories": ["pantry", "produce"],
        },
        {
            "id": "uuid-rice",
            "name": "Vegetable Fried Rice",
            "tags": ["vegetarian", "quick", "kid_friendly"],
            "prep_minutes": 20,
            "ingredient_categories": ["grains", "produce", "pantry"],
        },
    ],
    "low_stock_items": ["milk", "eggs"],
    "last_week_meals": [
        "Grilled Salmon with Veggies",
        "Pasta Carbonara",
        "Beef Stir Fry",
        "Red Lentil Soup",
        "Shakshuka",
        "Chicken Schnitzel",
        "Margherita Pizza",
    ],
}

# ── Call the agent ────────────────────────────────────────────────────────────

print("Generating weekly meal plan...")
print("-" * 60)

# dict
result = generate_weekly_plan(context)

if result["reason"] is not None and not result["days"]:
    print(f"Agent error: {result['reason']}")
    sys.exit(1)

# ── Print result ──────────────────────────────────────────────────────────────

print()
print("=" * 60)
print("AI SUMMARY")
print("=" * 60)
print(result["ai_summary"])
print()

# dict[str, str] — map day number to name for readable output
DAY_NAMES = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday",
             5: "Friday", 6: "Saturday", 7: "Sunday"}

print("=" * 60)
print("7-DAY PLAN")
print("=" * 60)

for day in sorted(result["days"], key=lambda d: d["day_of_week"]):
    # str — human-readable day name
    day_name = DAY_NAMES.get(day["day_of_week"], f"Day {day['day_of_week']}")

    # str — prep label formatted for display
    label_display = f"[{day['prep_label'].upper()}]"

    print(f"\n{day_name} {label_display}")
    print(f"  Meal     : {day['meal_name']}")
    print(f"  Recipe ID: {day['recipe_id'] or 'invented'}")

    if day["notes"]:
        print(f"  Notes    : {day['notes']}")

    if day["suggested_ingredients"]:
        print("  Ingredients to buy:")
        for ingredient in day["suggested_ingredients"]:
            print(f"    - {ingredient['quantity']} {ingredient['unit']} {ingredient['name']} [{ingredient['category']}]")

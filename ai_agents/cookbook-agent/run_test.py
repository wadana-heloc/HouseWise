import sys
sys.stdout.reconfigure(encoding="utf-8")

# run_test.py
#
# Smoke test for the Cookbook agent using real API calls.
# Runs generate_recipe() then personalize_recipe_description() for two
# different household members so we can see the personalization contrast.

import json
import os

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from cookbook_agent import generate_recipe, personalize_recipe_description

# dict — a kid member who is picky and avoids vegetables
kid_member = {
    "display_name": "Ahmed",
    "age_group": "kid",
    "taste_preferences": "hates broccoli and anything green",
    "health_preferences": {
        "high_protein": False,
        "low_calories": False,
        "low_carbs": False,
        "low_sugar": True,
        "whole_grain": False,
    },
}

# dict — an adult member focused on building muscle
adult_member = {
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
}

# dict — the household context sent to generate_recipe
household_context = {
    "tag_hints": ["high_protein", "kid_friendly"],
    "household_members": [kid_member, adult_member],
}

# ── Step 1: Generate the recipe ──────────────────────────────────────────────

print("=" * 60)
print("STEP 1: generate_recipe()")
print("=" * 60)
print()

# dict
recipe = generate_recipe(
    prompt="A high-protein pasta the whole family will enjoy",
    household_context=household_context,
)

if recipe["reason"] is not None:
    print(f"Agent returned an error: {recipe['reason']}")
    sys.exit(1)

print(f"Name        : {recipe['name']}")
print(f"Description : {recipe['description']}")
print(f"Prep time   : {recipe['prep_minutes']} minutes")
print(f"Servings    : {recipe['servings']}")
print(f"Tags        : {', '.join(recipe['tags'])}")
print()
print("Ingredients:")
for ingredient in recipe["ingredients"]:
    print(f"  - {ingredient['quantity']} {ingredient['unit']} {ingredient['name']} [{ingredient['category']}]")
print()
print("Instructions:")
print(recipe["instructions"])
print()

# ── Step 2: Personalize for the kid ──────────────────────────────────────────

print("=" * 60)
print("STEP 2: personalize_recipe_description() — Ahmed (kid)")
print("=" * 60)
print()

# str
kid_description = personalize_recipe_description(
    recipe=recipe,
    member_profile=kid_member,
    recent_history=[],
)

print(kid_description)
print()

# ── Step 3: Personalize for the adult ────────────────────────────────────────

print("=" * 60)
print("STEP 3: personalize_recipe_description() — Nour (adult, high protein)")
print("=" * 60)
print()

# str
adult_description = personalize_recipe_description(
    recipe=recipe,
    member_profile=adult_member,
    recent_history=[
        {"recipe_name": recipe["name"], "eaten_on": "2026-05-26", "reaction": "loved"}
    ],
)

print(adult_description)
print()

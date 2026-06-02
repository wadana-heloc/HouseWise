# AI Engineer Plan — Cookbook + Meal Planning

> Companion plans: [backend-engineer-plan.md](backend-engineer-plan.md) | [frontend-engineer-plan.md](frontend-engineer-plan.md)
> Master decisions: [cookbook-feature-wael-zany-pumpkin.md](cookbook-feature-wael-zany-pumpkin.md)

---

## Your Responsibility

Build **3 new AI agents**. Each agent is a standalone Python module called by the backend via `run_in_threadpool()`. You own the prompts, schemas, config, and error handling. You do NOT write API routes or frontend code.

**Existing agent patterns to study before starting:**
- `ai_agents/price-agent/price_agent.py` — canonical structure: client init, ephemeral caching, JSON pipeline, never-raises
- `ai_agents/image-agent/image_agent.py` — two-stage pipeline (OCR → text API), error fallback
- `ai_agents/coding-agent.md` — naming rules, comment style, encoding setup

---

## Naming Convention (mandatory)

All files prefixed with the agent name to avoid `sys.modules` collisions:

```
ai_agents/cookbook-agent/
    cookbook_agent.py       ← entry points
    cookbook_config.py      ← all literals (model name, prompts, token budgets)
    cookbook_schemas.py     ← Pydantic models
    requirements.txt        ← pinned versions

ai_agents/recipe-photo-agent/
    recipe_photo_agent.py
    recipe_photo_config.py
    recipe_photo_schemas.py
    requirements.txt

ai_agents/meal-plan-agent/
    meal_plan_agent.py
    meal_plan_config.py
    meal_plan_schemas.py
    requirements.txt
```

---

## Shared Conventions (apply to all 3 agents)

```python
# Top of every agent file
import sys
sys.stdout.reconfigure(encoding='utf-8')  # Windows UTF-8

import anthropic
import json
from dotenv import load_dotenv
load_dotenv()

# anthropic.Anthropic — reads ANTHROPIC_API_KEY from the environment automatically
client = anthropic.Anthropic()
```

**JSON output pipeline:**
```python
def _strip_markdown_fences(raw_text: str) -> str:
    if not raw_text.startswith('```'):
        return raw_text
    # Split on first newline only — never split on ``` globally, backticks inside
    # JSON content (e.g. recipe names) would corrupt the extraction.
    content_after_opening_fence = raw_text.split('\n', 1)[-1]
    return content_after_opening_fence.rsplit('```', 1)[0].strip()

def _extract_json_object(text: str) -> str:
    object_start_index = text.find('{')
    object_end_index = text.rfind('}')
    if object_start_index == -1 or object_end_index == -1:
        return text
    return text[object_start_index : object_end_index + 1]
```

**Never-raises pattern:**
```python
def my_entry_point(arg) -> dict:
    try:
        # ... actual logic
    except Exception as exc:
        return {'reason': f'Agent error: {exc}', ...null fields...}
```

**Ephemeral prompt caching:**
```python
messages = [
    {
        'role': 'user',
        'content': [
            {
                'type': 'text',
                'text': SYSTEM_PROMPT,
                'cache_control': {'type': 'ephemeral'},
            },
            {
                'type': 'text',
                'text': user_payload_json,
            }
        ]
    }
]
response = client.messages.create(
    model=MODEL_NAME,
    max_tokens=MAX_TOKENS,
    messages=messages,
)
```

**Important:** The `category` field in any ingredient list MUST be one of:
`dairy | meat | grains | bakery | pantry | produce | frozen | drinks | cleaning | other`
Enforce this in every system prompt that produces ingredients.

---

## Agent 1: Cookbook Agent ✅ Delivered

### Entry Points

**Function 1: `generate_recipe`**

```python
def generate_recipe(prompt: str, household_context: dict) -> dict:
    """
    What: Generates a complete recipe based on a text prompt and household member profiles.
    Input: prompt (str), household_context ({tag_hints, household_members})
    Output: {name, description, ingredients, instructions, tags, prep_minutes, servings, reason}
    Returns: always returns dict, never raises
    """
```

`household_context` shape — note: `prompt` is a separate argument, NOT inside this dict:
```python
{
    'tag_hints': ['high_protein', 'kid_friendly'],
    'household_members': [
        {
            'display_name': 'Ahmed',
            'age_group': 'kid',
            'taste_preferences': 'hates broccoli',
            'health_preferences': {
                'high_protein': True,
                'low_calories': False,
                'low_carbs': False,
                'low_sugar': False,
                'whole_grain': False,
            }
        }
    ]
}
```

Output shape:
```python
{
    'name': 'Hidden Veggie Protein Pasta',
    'description': 'A rich tomato pasta secretly packed with protein...',
    'ingredients': [
        {'name': 'chicken breast', 'quantity': '500', 'unit': 'g', 'category': 'meat'},
        {'name': 'penne pasta', 'quantity': '400', 'unit': 'g', 'category': 'grains'},
    ],
    'instructions': '1. Boil pasta...',
    'tags': ['high_protein', 'kid_friendly'],
    'prep_minutes': 30,
    'servings': 4,
    'reason': None,  # null on success, error string on failure
}
```

---

**Function 2: `personalize_recipe_description`**

```python
def personalize_recipe_description(
    recipe: dict,
    member_profile: dict,
    recent_history: list[dict],
) -> str:
    """
    What: Writes a personalized 2-4 sentence description of a recipe for one specific member.
    Input: recipe (full recipe dict), member_profile ({display_name, age_group,
           taste_preferences, health_preferences}), recent_history (last 5 recipe_history entries)
    Output: plain text string (no JSON, no markdown)
    Returns: always returns str (empty string on failure), never raises
    """
```

`recent_history` entry shape:
```python
{'recipe_name': 'Chicken Curry', 'eaten_on': '2026-05-25', 'reaction': 'loved'}
```

**System prompt guidance:**
- Return ONLY plain text — no JSON, no markdown, no quotes
- Write in second person ("you'll love...", "this dish gives you...")
- **Kid** (`age_group='kid'`): Focus on taste, fun, texture. Never mention vegetables by name. Say "secret sauce" or "hidden goodness."
- **Adult, `high_protein=true`**: Lead with protein content and muscle/recovery benefits
- **Adult, `low_calories=true`**: Emphasize lightness, how filling it is per calorie
- If `recent_history` contains this recipe eaten within 14 days: open with "You had this last week — still a great choice!"
- If reaction was `'disliked'`: note it's available but suggest trying it again fresh
- 2–4 sentences max

### `cookbook_config.py`

```python
MODEL_NAME = 'claude-sonnet-4-6'
GENERATE_MAX_TOKENS = 2000
PERSONALIZE_MAX_TOKENS = 400

GENERATE_SYSTEM_PROMPT = """You are a professional recipe developer for a family household app.
Generate a single recipe based on the household's prompt and member preferences.

Return ONLY a valid JSON object with this exact structure:
{
  "name": string,
  "description": string (canonical, neutral, 1-3 sentences),
  "ingredients": [{"name": string, "quantity": string, "unit": string, "category": string}],
  "instructions": string (numbered steps, each on a new line),
  "tags": [string],
  "prep_minutes": integer,
  "servings": integer,
  "reason": null
}

Rules:
- category MUST be one of: dairy, meat, grains, bakery, pantry, produce, frozen, drinks, cleaning, other
- No markdown, no backticks, no prose outside the JSON
- quantity should be a number as a string (e.g. "500", "2")
- tags examples: high_protein, kid_friendly, low_carb, quick, prep_once_eat_twice, vegetarian
"""

PERSONALIZE_SYSTEM_PROMPT = """You are a personal meal companion for a household app.
Write a short, personalized description of a recipe for one specific family member.

Return ONLY plain text — no JSON, no markdown, no quotes.
Write in second person. 2-4 sentences maximum.
Tailor language to the member's age group, health goals, and taste preferences.
"""
```

### `cookbook_schemas.py`

```python
from pydantic import BaseModel
from typing import Optional

class RecipeIngredient(BaseModel):
    name: str
    quantity: str
    unit: str
    category: str

class GeneratedRecipe(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    ingredients: list[RecipeIngredient] = []
    instructions: Optional[str] = None
    tags: list[str] = []
    prep_minutes: Optional[int] = None
    servings: Optional[int] = None
    reason: Optional[str] = None
```

### `requirements.txt`

```
anthropic>=0.40.0
pydantic>=2.0.0
python-dotenv>=1.0.0
pytest>=8.0.0
```

---

## Agent 2: Recipe Photo Agent ✅ Delivered

### Entry Point

```python
def extract_recipe_from_image(image_base64: str, media_type: str) -> dict:
    """
    What: Extracts a complete recipe from a photo of a cookbook page using Claude Vision.
    Input: image_base64 (str), media_type ('image/jpeg' | 'image/png' | 'image/webp')
    Output: {name, description, ingredients, instructions, tags, prep_minutes, servings, reason}
    Returns: always returns dict, never raises
    """
```

**Why no EasyOCR:** Recipe pages use multi-column layouts, embedded photos, and fraction symbols (½, ¾). OCR reads left-to-right and loses column structure — quantities end up misaligned from ingredient names. Claude Vision understands spatial layout in one pass.

**Model: `claude-haiku-4-5-20251001` (not Sonnet)**
Haiku still understands spatial layout but costs ~6× less per image (~$0.008 vs ~$0.05). Recipe extraction is a one-time scan action per recipe, so accuracy/cost lands in Haiku's favour.

### `recipe_photo_config.py`

```python
RECIPE_PHOTO_MODEL_NAME = 'claude-haiku-4-5-20251001'
RECIPE_PHOTO_MAX_TOKENS = 3000
RECIPE_PHOTO_EXTRACT_USER_TEXT = 'Extract the recipe from this image.'
```

---

## Agent 3: Meal Plan Agent ✅ Delivered

### Entry Point

```python
def generate_weekly_plan(context: dict) -> dict:
    """
    What: Generates a 7-day dinner plan for a household based on member submissions.
    Input: context dict (see shape below)
    Output: {ai_summary, days: [{day_of_week, recipe_id, meal_name, prep_label,
             notes, suggested_ingredients}], reason}
    Returns: always returns dict, never raises
    """
```

`context` shape — two key design decisions vs. original plan:
1. `available_recipes` sends `ingredient_categories` (unique set) instead of full ingredient lists — gives Claude freshness ordering without token bloat
2. `last_week_meals` added — prevents repeating recipes week after week

```python
{
    'week_start': '2026-06-08',
    'household_members': [
        {
            'display_name': 'Nour',
            'age_group': 'adult',
            'taste_preferences': 'loves spicy food',
            'health_preferences': {'high_protein': True, ...},
            'busy_days': [2, 4],       # ISO weekday: 1=Mon, 7=Sun
            'meal_requests': [
                {'description': 'I want burgers', 'recipe_id': None},
            ]
        }
    ],
    'available_recipes': [
        {
            'id': 'uuid',
            'name': 'Chicken Curry',
            'tags': ['high_protein', 'prep_once_eat_twice'],
            'prep_minutes': 40,
            'ingredient_categories': ['meat', 'dairy', 'produce', 'pantry']  # unique categories only
        }
    ],
    'low_stock_items': ['milk', 'eggs'],
    'last_week_meals': [               # meal names from previous week — Claude avoids repeating them
        'Chicken Curry', 'Grilled Salmon', 'Pasta Carbonara', ...
    ],
}
```

Output shape:
```python
{
    'ai_summary': "Monday's salmon uses the freshest ingredients. Burgers Wednesday for Ahmed as requested...",
    'days': [
        {
            'day_of_week': 1,
            'recipe_id': 'uuid',        # null when Claude invented the meal
            'meal_name': 'Grilled Salmon',
            'prep_label': 'prep',       # 'prep' | 'reheat' | 'fresh'
            'notes': 'Cook double batch — leftovers used Wednesday',
            'suggested_ingredients': [] # only populated when recipe_id is null
        },
        {
            'day_of_week': 2,
            'recipe_id': None,
            'meal_name': 'Homemade Burgers',
            'prep_label': 'fresh',
            'notes': "Ahmed's request — no match in cookbook",
            'suggested_ingredients': [
                {'name': 'beef mince', 'quantity': '500', 'unit': 'g', 'category': 'meat'},
            ]
        }
    ],
    'reason': None,                     # null on success, error string on failure
}
```

### System Prompt Rules (implemented)

```
FRESHNESS ORDERING:
- Recipes with ingredient_categories containing 'meat', 'produce', or 'dairy': assign to days 1–3
- Recipes relying on 'grains', 'pantry', or 'frozen': assign to days 4–7

VARIETY:
- Do NOT assign any meal whose name appears in last_week_meals
- If a member requests a last-week recipe, honor it but note it in ai_summary

BUSY DAYS:
- A day is busy if ANY member lists it in busy_days
- On busy days: assign 'reheat' or 'fresh' only — never 'prep'

COOK-ONCE-EAT-TWICE:
- If a day is 'prep', at least one later day must 'reheat' that same meal
- The prep day's notes must state which day leftovers will be used

MEMBER REQUESTS:
- Match request to available_recipes by name; set recipe_id if matched
- If no match: recipe_id=null, populate suggested_ingredients

SUGGESTED INGREDIENTS:
- Only populate when recipe_id is null
- For recipe_id recipes: leave suggested_ingredients as []
- category MUST be: dairy|meat|grains|bakery|pantry|produce|frozen|drinks|cleaning|other
```

### `meal_plan_config.py`

```python
MEAL_PLAN_MODEL_NAME = 'claude-sonnet-4-6'
MEAL_PLAN_MAX_TOKENS = 4000
```

---

## Testing

Each agent has a `test_<name>_agent.py` using **mocked API calls** (no real API key needed for unit tests) and a `run_test.py` for real smoke testing.

Tests cover every function: the three JSON parsing helpers + all entry points. Key assertions per agent:

**Cookbook agent:** valid recipe structure, all ingredient categories in allowed set, never raises on bad input, `reason` set on API error.

**Recipe photo agent:** valid recipe structure, image content block format verified (type/source/media_type/data), Haiku model confirmed, non-recipe image returns reason not exception.

**Meal plan agent:** exactly 7 days returned, `day_of_week` covers 1–7 with no gaps, all `prep_label` values valid, `suggested_ingredients` empty for cookbook recipes, `last_week_meals` and `ingredient_categories` present in API payload.

---

## Handoff to Backend Engineer

All 3 agents are delivered. See `backend-engineer-plan.md` Phase 3 and Phase 5 for the full confirmed contracts with Supabase query code.

**Agent locations:**
```
ai_agents/cookbook-agent/cookbook_agent.py         → generate_recipe, personalize_recipe_description
ai_agents/recipe-photo-agent/recipe_photo_agent.py → extract_recipe_from_image
ai_agents/meal-plan-agent/meal_plan_agent.py        → generate_weekly_plan
```

**Import pattern per agent (three separate path inserts):**
```python
sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'cookbook-agent'))
from cookbook_agent import generate_recipe, personalize_recipe_description

sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'recipe-photo-agent'))
from recipe_photo_agent import extract_recipe_from_image

sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'meal-plan-agent'))
from meal_plan_agent import generate_weekly_plan
```

**`ANTHROPIC_API_KEY` must be in the backend's `.env`** — all agents read it automatically via `anthropic.Anthropic()`.

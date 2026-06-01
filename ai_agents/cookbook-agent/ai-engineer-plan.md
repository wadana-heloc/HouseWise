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
import os
from dotenv import load_dotenv
load_dotenv()

client = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
```

**JSON output pipeline (same as price agent):**
```python
def _strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith('```'):
        text = text[text.index('\n')+1:]
    if text.endswith('```'):
        text = text[:text.rindex('```')]
    return text.strip()

def _extract_json_object(text: str) -> str:
    start = text.index('{')
    end = text.rindex('}') + 1
    return text[start:end]
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

## Agent 1: Cookbook Agent

### Entry Points

**Function 1: `generate_recipe`**

```python
def generate_recipe(prompt: str, household_context: dict) -> dict:
    """
    What: Generates a complete recipe based on a text prompt and household member profiles.
    Input: prompt (str), household_context ({prompt, tag_hints, household_members})
    Output: {name, description, ingredients, instructions, tags, prep_minutes, servings, reason}
    Returns: always returns dict, never raises
    """
```

`household_context` shape:
```python
{
    'prompt': 'A high-protein pasta kids will eat',
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

## Agent 2: Recipe Photo Agent

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

**Key difference from `image_agent.py`:** No EasyOCR — sends the image directly to Claude Vision. Recipe pages have complex layouts (columns, photography) that need full vision understanding, not OCR preprocessing.

**Implementation:**

```python
def extract_recipe_from_image(image_base64: str, media_type: str) -> dict:
    try:
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=MAX_TOKENS,
            messages=[
                {
                    'role': 'user',
                    'content': [
                        {
                            'type': 'text',
                            'text': EXTRACT_SYSTEM_PROMPT,
                            'cache_control': {'type': 'ephemeral'},
                        },
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': media_type,
                                'data': image_base64,
                            },
                        },
                        {
                            'type': 'text',
                            'text': 'Extract the recipe from this image.',
                        }
                    ],
                }
            ],
        )
        raw = response.content[-1].text
        cleaned = _strip_markdown_fences(raw)
        data = json.loads(_extract_json_object(cleaned))
        return RecipePhotoResult(**data).model_dump()
    except Exception as exc:
        return RecipePhotoResult(reason=f'Extraction failed: {exc}').model_dump()
```

### `recipe_photo_config.py`

```python
MODEL_NAME = 'claude-sonnet-4-6'
MAX_TOKENS = 3000

EXTRACT_SYSTEM_PROMPT = """You are a recipe extraction specialist. Extract the complete recipe
from the cookbook page image provided.

Return ONLY a valid JSON object with this exact structure:
{
  "name": string or null,
  "description": string or null,
  "ingredients": [{"name": string, "quantity": string, "unit": string, "category": string}],
  "instructions": string or null (numbered steps),
  "tags": [string],
  "prep_minutes": integer or null,
  "servings": integer or null,
  "reason": null (or brief note if extraction was partial)
}

Rules:
- category MUST be one of: dairy, meat, grains, bakery, pantry, produce, frozen, drinks, cleaning, other
- If a field is not visible in the image, set it to null
- If the image is not a recipe page, return all fields as null and explain in "reason"
- No markdown, no backticks, no prose outside the JSON
"""
```

---

## Agent 3: Meal Plan Agent

### Entry Point

```python
def generate_weekly_plan(context: dict) -> dict:
    """
    What: Generates a 7-day dinner plan for a household based on member submissions.
    Input: context dict (see shape below)
    Output: {ai_summary, days: [{day_of_week, recipe_id, meal_name, prep_label,
             notes, suggested_ingredients}]}
    Returns: always returns dict, never raises
    """
```

`context` shape:
```python
{
    'week_start': '2026-06-08',
    'household_members': [
        {
            'user_id': 'uuid',
            'display_name': 'Nour',
            'age_group': 'adult',
            'taste_preferences': 'loves spicy food',
            'health_preferences': {'high_protein': True, ...},
            'busy_days': [2, 4],  # ISO: 1=Mon, 7=Sun
            'meal_requests': [
                {'description': 'I want burgers', 'recipe_id': None},
            ]
        }
    ],
    'available_recipes': [
        {'id': 'uuid', 'name': 'Chicken Curry', 'tags': ['high_protein', 'prep_once_eat_twice'], 'ingredients': [...]}
    ],
    'low_stock_items': ['milk', 'eggs'],
}
```

Output shape:
```python
{
    'ai_summary': "Monday's chicken curry cooks in bulk — reheated Wednesday. Burgers on Thursday for Nour as requested. Ahmed's Chinese food request couldn't fit this week; suggest it next Sunday.",
    'days': [
        {
            'day_of_week': 1,
            'recipe_id': 'uuid',        # null if invented
            'meal_name': 'Chicken Curry',
            'prep_label': 'prep',       # 'prep' | 'reheat' | 'fresh'
            'notes': 'Cook double batch — use leftovers Wednesday',
            'suggested_ingredients': [] # only populated when recipe_id is null
        },
        {
            'day_of_week': 2,
            'recipe_id': None,
            'meal_name': 'Quick Pasta Aglio e Olio',
            'prep_label': 'fresh',
            'notes': 'Busy day for 3 members — 15 min meal',
            'suggested_ingredients': [
                {'name': 'spaghetti', 'quantity': '400', 'unit': 'g', 'category': 'grains'},
            ]
        }
    ]
}
```

### System Prompt Rules

```
RULES FOR DAYS:
- Generate exactly 7 entries (day_of_week 1 through 7)
- Dinners only — one entry per day
- prep_label: 'prep' (cook in bulk), 'reheat' (leftover from prep day), 'fresh' (quick cook)
- On busy_days: assign 'reheat' or 'fresh' meals only
- Apply cook-once-eat-twice: if a day is 'prep', at least one later day should 'reheat' it
- If a member request matches an available_recipe: set recipe_id; else recipe_id=null + suggested_ingredients
- ingredient category MUST be: dairy|meat|grains|bakery|pantry|produce|frozen|drinks|cleaning|other

RULES FOR ai_summary:
- Mention every member's requests — both met and unmet
- For unmet: explain briefly why and suggest carrying to next week
- Mention the prep-once strategy used
- 3-6 sentences

OUTPUT: Return ONLY a valid JSON object. No markdown, no backticks, no prose outside JSON.
```

### `meal_plan_config.py`

```python
MODEL_NAME = 'claude-sonnet-4-6'
MAX_TOKENS = 4000
SYSTEM_PROMPT = """..."""  # Full system prompt as above
```

---

## Testing

Each agent gets a `test_<name>_agent.py` using real API calls:

**`test_cookbook_agent.py`:**
```python
def test_generate_recipe_returns_valid_structure():
    from cookbook_agent import generate_recipe
    result = generate_recipe('A quick pasta for a family with kids', {...})
    assert result['name'] is not None
    valid_categories = {'dairy','meat','grains','bakery','pantry','produce','frozen','drinks','cleaning','other'}
    for ing in result['ingredients']:
        assert ing['category'] in valid_categories

def test_generate_recipe_never_raises_on_bad_input():
    from cookbook_agent import generate_recipe
    result = generate_recipe('', {})
    assert 'reason' in result
```

**`test_meal_plan_agent.py`:**
```python
def test_generate_plan_returns_7_days():
    from meal_plan_agent import generate_weekly_plan
    result = generate_weekly_plan({...minimal context...})
    assert len(result['days']) == 7
    valid_labels = {'prep', 'reheat', 'fresh'}
    for day in result['days']:
        assert day['prep_label'] in valid_labels
```

---

## Handoff to Backend Engineer

Share:
1. Function signatures above — these are the contract
2. `requirements.txt` for each agent (backend must install deps)
3. Path convention: `ai_agents/cookbook-agent/cookbook_agent.py` (backend imports via `sys.path.insert`)
4. Confirm `ANTHROPIC_API_KEY` is in the backend's `.env`

The backend calls your functions like this:
```python
sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'cookbook-agent'))
from cookbook_agent import generate_recipe
result = await run_in_threadpool(generate_recipe, prompt, household_context)
```

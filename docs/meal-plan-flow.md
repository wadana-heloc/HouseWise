# Meal-plan flow

Per-household weekly meal plans. Family members submit busy days + meal requests; admin triggers AI generation; the result is one [`public.meal_plans`](../supabase/migrations/0009_init_meal_plan.sql) row plus exactly 7 [`public.meal_plan_days`](../supabase/migrations/0009_init_meal_plan.sql) rows. Source of truth: [supabase/migrations/0009_init_meal_plan.sql](../supabase/migrations/0009_init_meal_plan.sql) and [backend/app/meal_plan/router.py](../backend/app/meal_plan/router.py).

The AI agent function lives outside the backend tree under [ai_agents/meal-plan-agent/](../ai_agents/meal-plan-agent/); we reach it via the sys.path shim in [backend/app/main.py](../backend/app/main.py).

---

## Resources

- **`public.meal_plan_submissions`** — one row per `(household_id, user_id, week_start)`. Stores `busy_days` (`int[]`, ISO weekday 1=Mon..7=Sun), `meal_requests` (JSONB array of `{description, recipe_id}`), and `week_notes` (free-text up to 2000 chars, nullable — per-submission note like "hosting Friday, need easy meals").
- **`public.meal_plans`** — one row per `(household_id, week_start)`. `status` is `'draft' | 'finalized'` (only `'draft'` is written this PR; `'finalized'` is pre-added for the deferred finalize flow).
- **`public.meal_plan_days`** — exactly 7 rows per plan, keyed by `(plan_id, day_of_week)`. `prep_label` is `'prep' | 'reheat' | 'fresh'`. `recipe_id` is nullable (agent can invent meals that aren't in the cookbook). `suggested_ingredients` (JSONB) is stored even though unused this PR — the finalize PR consumes it to build the shopping list for agent-invented meals.

---

## Endpoints

| Method | Path | Caller | Body | Notes |
| --- | --- | --- | --- | --- |
| POST | `/meal-plan/submissions` | any member | `SubmissionUpsert` | Upsert caller's own submission for `week_start`. Re-submitting same week replaces. |
| GET | `/meal-plan/submissions/me?week_start=...` | any member | — | Caller's own submission. 404 if not yet submitted. |
| GET | `/meal-plan/submissions/status?week_start=...` | any member | — | Per-member `submitted: bool` + `submitted` / `total` counts. Booleans only; never the contents of another member's submission. |
| GET | `/meal-plan/{week_start}` | any member | — | Plan + 7 days sorted by `day_of_week`. 404 if no plan yet. |
| POST | `/meal-plan/generate` | admin | `GenerateMealPlanRequest` | Calls `generate_weekly_plan` agent. Upserts plan; replaces 7 day rows. 502 on total agent failure. |
| PATCH | `/meal-plan/{plan_id}/days/{day_id}` | admin | `DayUpdate` (≥1 field) | Edit one day's `meal_name`, `prep_label`, `notes`, or `recipe_id`. Returns the full updated plan. |
| POST | `/meal-plan/{plan_id}/finalize` | admin | — | Flip `status` to `'finalized'` and auto-populate the shopping list with the week's ingredients (deduped within-batch). Idempotent. |

---

## Lifecycle

```
admin POST /generate ──► status='draft'  ──► admin POST /{id}/finalize ──► status='finalized'
                        7 day rows                                         items inserted (deduped)
                        visible to all                                     visible to all
```

There is no admin approval gate. The status flag exists so the FE can render a "Draft" badge before the admin commits, and so the backend has a no-op signal for idempotent re-finalize. **Backend visibility is the same in both states** — the FE chooses what to render based on the `status` field already in the response.

`POST /meal-plan/generate` for an existing week **replaces** the plan — the row is upserted (`on_conflict='household_id,week_start'`) and the 7 day rows are deleted and re-inserted. If the plan was already `'finalized'`, generate resets it to `'draft'` (clean slate for re-finalize). Items already inserted by the previous finalize are NOT cleaned up automatically — admin curates the items queue.

---

## AI agent contract — what the backend passes

### `generate_weekly_plan(context: dict) -> dict`

```python
context = {
    "week_start": "2026-06-01",
    "household_members": [
        {
            "display_name": "Maha",
            "age_group": None,            # column not in our schema
            "taste_preferences": None,    # column not in our schema
            "health_preferences": {       # from public.users.health_preferences (JSONB)
                "high_protein": False,
                "low_calories": True,
                "low_carbs": False,
                "low_sugar": False,
                "whole_grain": True,
            },
            "dietary_preferences": {      # from public.users.dietary_preferences (JSONB)
                "dietary_types": ["vegetarian"],
                "allergies": ["peanuts"],
                "dislikes": ["broccoli"],
            },
            "busy_days": [3, 5],
            "meal_requests": [
                {"description": "something quick", "recipe_id": None},
            ],
            "week_notes": "hosting Friday, need easy meals",   # from submission row, may be null
        },
        ...
    ],
    "available_recipes": [
        {
            "id": "uuid",
            "name": "Chicken Tikka",
            "tags": ["high protein"],
            "prep_minutes": 30,
            "ingredient_categories": ["meat", "produce", "pantry"],
        },
        ...
    ],
    "low_stock_items": ["Olive oil", "Salt"],   # from public.low_stock_flags
    "last_week_meals": ["Pasta", "Salad", ...], # for anti-repetition
}
```

`age_group` and `taste_preferences` are passed as **`None`** because those columns don't exist in our schema. The agent must handle missing values — if it crashes on `None`, that's an AI-team-side fix, not a backend workaround.

`dietary_preferences` is always present with the full 3-key shape (empty lists for unset keys) because the DB column has a default. `week_notes` is `null` for members who didn't submit, or who submitted without a note. **The chip values in `dietary_types` are FE-controlled free-text strings** — not a backend-validated enum. Belal's call so the FE can grow the chip set without a deploy; cost is the agent has to be tolerant of typo'd or unknown values.

`low_stock_items` is pulled from **`public.low_stock_flags`** — `public.items` has no `'low_stock'` status enum value, contrary to what the AI engineer's "backend plan" assumed.

### Return shape

```python
{
    "ai_summary": str | None,
    "days": [
        {
            "day_of_week": int,            # 1=Mon..7=Sun; exactly 7 entries
            "recipe_id": str | None,       # None when the agent invented the meal
            "meal_name": str,
            "prep_label": str,             # 'prep' | 'reheat' | 'fresh'
            "notes": str | None,
            "suggested_ingredients": [     # populated when recipe_id is None
                {"name": str, "quantity": str, "unit": str, "category": str}
            ],
        },
        ...
    ],
    "reason": str | None,
}
```

- `reason is None` → success. Upsert plan + insert 7 days.
- `reason and not days` → **total failure**. Backend raises **502**, no row is inserted.
- `len(days) != 7` → treated as total failure (502, no row).

---

## Finalize — what gets inserted into `items`

`POST /meal-plan/{plan_id}/finalize` collects ingredients from each of the 7 days:

- **Days with `recipe_id` set** → pull from `recipes.ingredients` (joined in one query).
- **Days with `recipe_id IS NULL`** → use `meal_plan_days.suggested_ingredients` (already JSONB on the row).

Then dedup within-batch by `lower(name).strip()`. First occurrence wins so the original casing is preserved. One `public.items` INSERT per unique name.

**Inserted row shape:**

| column | value |
| --- | --- |
| `name` | `ingredient.name` (original casing) |
| `category` | `ingredient.category` (already a valid `item_category` enum) |
| `quantity` | parsed `Decimal` from `ingredient.quantity`; falls back to `1` if the recipe used a non-numeric string like "a pinch" |
| `unit` | hardcoded `'units'` — recipe units (cups, tbsp, ...) don't map to the strict `ItemUnit` enum |
| `status` | `'pending'` (admin promotes / rejects from the items queue) |
| `notes` | `"From meal plan: 2026-06-01 (200 g)"` — keeps the original qty+unit since we drop them from the structured columns |
| `added_by` | admin who finalized |

**Existing items in the household are NOT considered.** If "Olive oil" is already pending from a low-stock flag and the plan needs it too, finalize adds a second row. Admin merges manually from the items queue. This avoids a unique constraint / merge layer we don't need yet.

Ingredients with an empty/missing `name` or a `category` that isn't in the `item_category` enum are **skipped with a warning log** (`housewise.meal_plan` logger). The rest of the finalize call still succeeds.

---

## Why 502 (not 200-with-reason)

Same split as the cookbook AI endpoints. Meal-plan generate **writes a row**, so a total agent failure means no plan exists for the client to look up afterwards. Returning 200 there would force every caller to inspect the body to know whether persistence happened. 502 makes "we tried but couldn't" structurally distinct from "here's a saved plan."

Scan-image (`POST /items/scan-image`) is pass-through and uses 200-always with the failure shape in the body — different shape because there's no row to confirm.

---

## Permissions matrix

| Action | admin | family |
| --- | :---: | :---: |
| Submit own week (`POST /submissions`) | ✓ | ✓ |
| Read own submission (`GET /submissions/me`) | ✓ | ✓ |
| Read per-member status (`GET /submissions/status`) | ✓ | ✓ |
| Read plan (`GET /meal-plan/{week}`) | ✓ | ✓ |
| Generate plan (`POST /generate`) | ✓ | ✗ |
| Edit a day (`PATCH /{plan_id}/days/{day_id}`) | ✓ | ✗ |
| Finalize plan (`POST /{plan_id}/finalize`) | ✓ | ✗ |

Cross-household access is always **404** so existence isn't leaked.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 on submission with `busy_days: [0, ...]` | Validator in `SubmissionUpsert` | [meal_plan/schemas.py](../backend/app/meal_plan/schemas.py) |
| 422 on submission with duplicate `busy_days` | Same validator | [meal_plan/schemas.py](../backend/app/meal_plan/schemas.py) |
| 422 on PATCH with empty body | `_at_least_one_field` validator | [meal_plan/schemas.py](../backend/app/meal_plan/schemas.py) `DayUpdate` |
| 422 on bad `prep_label` | `PrepLabel` Literal | [meal_plan/schemas.py](../backend/app/meal_plan/schemas.py) |
| 403 on POST `/generate` / PATCH day | Not admin / not in household | [meal_plan/router.py](../backend/app/meal_plan/router.py) |
| 404 on GET `/meal-plan/{week}` | No plan exists yet for that week | [meal_plan/router.py](../backend/app/meal_plan/router.py) `get_plan` |
| 404 on PATCH day | Day not found, plan_id mismatch, or cross-household | [meal_plan/router.py](../backend/app/meal_plan/router.py) `update_day` |
| 404 on POST `/finalize` | Plan not in caller's household | [meal_plan/router.py](../backend/app/meal_plan/router.py) `finalize` |
| Items missing after finalize | Ingredient had empty name or bad `category` — skipped with a warning log (search `housewise.meal_plan` for "skipping ingredient") | [meal_plan/router.py](../backend/app/meal_plan/router.py) `finalize` |
| Duplicate items after re-generate + re-finalize | Items from the first finalize aren't cleaned up when `/generate` resets status to draft. Admin reviews the items queue and merges manually. | [meal_plan/router.py](../backend/app/meal_plan/router.py) `finalize` |
| 502 on `/generate` | Agent returned `reason` with empty `days`, or `len(days) != 7` | [meal_plan/router.py](../backend/app/meal_plan/router.py) `generate` |
| 500 on import at startup | `ImportError` from `meal_plan_agent` — agent folder missing or has dep failure | [main.py](../backend/app/main.py) sys.path loop; the import is module-level so failures crash boot rather than hide |

---

## Still deferred

- **`GET /meal-plan/{week}/prices`** — frontend polls this after finalize. Needs `meal_plans.price_results` JSONB column (not added yet).
- **Background price search task** triggered by finalize. Same blocker as above.
- **`recipe_history`** table + per-day reactions (`/meal-plan/{id}/react`). No reactions UI yet.
- **Generate as family.** Admin-only; the family screen only shows submit + read, not the generate button.
- **Submission prefill from last week** ("same busy days as last week" suggestion).
- **Items dedup against the existing household items.** Finalize appends; admin merges from the items queue.
- **"Un-finalize" endpoint.** Admin can re-run `/generate` to reset to draft if they need to start over.

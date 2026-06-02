# Cookbook flow

Per-household recipe book. Three creation paths (Manual / AI Generate / Photo Extract) feed one `public.recipes` table. Source of truth: [supabase/migrations/0008_init_cookbook.sql](../supabase/migrations/0008_init_cookbook.sql) and [backend/app/cookbook/router.py](../backend/app/cookbook/router.py).

AI agent functions live outside the backend tree under [ai_agents/cookbook-agent/](../ai_agents/cookbook-agent/) and [ai_agents/recipe-photo-agent/](../ai_agents/recipe-photo-agent/); we reach them via the sys.path shim in [backend/app/main.py](../backend/app/main.py).

---

## Resource

`public.recipes` — see [0008_init_cookbook.sql](../supabase/migrations/0008_init_cookbook.sql). Highlights:

- `household_id` — every recipe belongs to exactly one household. Cascades on household delete.
- `name`, `description`, `instructions` — free text with DB-level length checks.
- `ingredients` — JSONB array of `{name, quantity, unit, category}`. `category` validates against the `public.item_category` enum at the app layer.
- `tags` — `text[]` with a GIN index; arbitrary values today (no enum), normalised case-as-typed.
- `source` — one of `manual`, `ai_generated`, `photo`.
- `status` — one of `pending`, `approved`. **Manual entries skip pending; AI/photo entries start pending.**
- `submitted_by` — `auth.users.id` of the creator, `ON DELETE SET NULL`.

---

## Endpoints

| Method | Path | Caller | Body | Notes |
| --- | --- | --- | --- | --- |
| GET | `/cookbook/recipes` | any member | — | Query params: `tag`, `search` (ilike on name), `source`, `status`. Default scope: approved + own pending. |
| POST | `/cookbook/recipes` | any member | `RecipeCreate` | Manual entry → `source='manual'`, `status='approved'`. |
| GET | `/cookbook/recipes/{id}` | any member | — | 404 cross-household; 404 if pending and not own/admin. |
| PATCH | `/cookbook/recipes/{id}` | admin | `RecipeUpdate` (≥1 field) | Edit any field including `status`. |
| DELETE | `/cookbook/recipes/{id}` | admin | — | Hard delete. |
| POST | `/cookbook/recipes/{id}/approve` | admin | — | Sets `status='approved'`. Idempotent. |
| POST | `/cookbook/recipes/generate` | any member | `GenerateRecipeRequest` | Calls `generate_recipe` agent. → `source='ai_generated'`, `status='pending'`. 502 on total failure. |
| POST | `/cookbook/recipes/extract-photo` | any member | `ExtractPhotoRequest` | Calls `extract_recipe_from_image` agent. → `source='photo'`, `status='pending'`. Partial extractions OK; 502 only on no-name failure. |

---

## Approval workflow

Two paths, one gate:

```
Manual entry ─────────────────────────────────► status='approved' (visible to all)

AI generate / photo extract ──► status='pending' ──► admin approves ──► visible to all
                                       │
                                       └► visible to submitter + admin only
```

**Why this split:**

- Manual: a human typed the recipe. They are their own reviewer. No friction.
- AI / photo: machine output is wrong sometimes. Admin scans the household pending queue (`GET /cookbook/recipes?status=pending`) and approves the good ones, deletes the rest.

**The submitter sees their own pending row** so they can preview and delete bad output before bothering an admin. Other family members don't see it (the SELECT policy filters on `submitted_by = auth.uid()` for non-approved rows).

Admin can also pre-empt the approve endpoint by `PATCH /cookbook/recipes/{id}` with `{status: 'approved'}` — useful if they want to edit and approve in one call.

---

## AI agent contract — what the backend passes

### `generate_recipe(prompt, household_context)`

```python
household_context = {
    "tag_hints": ["quick", "kid friendly"],          # from the request body
    "household_members": [
        {
            "display_name": "Maha",
            "age_group": None,                        # column not in our schema
            "taste_preferences": None,                # column not in our schema
            "health_preferences": {                   # from public.users.health_preferences (JSONB)
                "high_protein": False,
                "low_calories": True,
                "low_carbs": False,
                "low_sugar": False,
                "whole_grain": True,
            },
        },
        ...
    ],
}
```

`age_group` and `taste_preferences` are passed as **`None`** because those columns don't exist in our schema (the frontend dropped editing them before this PR). The agent must handle missing values — if it crashes on `None`, that's an AI-team-side fix, not a backend workaround.

### `extract_recipe_from_image(image_base64, media_type)`

Direct pass-through of the request body. `image_base64` is capped at `SCAN_IMAGE_MAX_BASE64` chars (see [items/schemas.py](../backend/app/items/schemas.py)) — same constant the scan-image endpoint uses.

### Return shape (both agents)

```python
{
    "name": str | None,
    "description": str | None,
    "ingredients": [{"name": str, "quantity": str, "unit": str, "category": str}],
    "instructions": str | None,
    "tags": list[str],
    "prep_minutes": int | None,
    "servings": int | None,
    "reason": str | None,
}
```

- `reason is None` → full success. Save.
- `reason and name` → partial success. Save anyway (extract-photo only annotates the description with the reason).
- `reason and not name` → **total failure**. Backend raises **502**, no row is inserted.

---

## Why 502, not 200-with-reason (like scan-image)

The image-scan endpoint (`POST /items/scan-image`) returns 200 even on agent failure, with the failure shape in the response body. That's correct because scan-image is **pass-through** — there's no row to confirm.

Cookbook generate and extract-photo are **writes**. A total agent failure means no row exists for the client to look up afterwards. Returning 200 there would force every caller to inspect the body to know whether persistence happened. 502 makes "we tried but couldn't" structurally distinct from "here's a saved recipe."

Partial photo extractions still 201 because there IS a row — the description just has an "Extraction note:" suffix.

---

## Permissions matrix

| Action | admin | family (submitter) | family (other) |
| --- | :---: | :---: | :---: |
| Create manual (auto-approved) | ✓ | ✓ | ✓ |
| Create via AI generate | ✓ | ✓ | ✓ |
| Create via photo extract | ✓ | ✓ | ✓ |
| List approved recipes | ✓ | ✓ | ✓ |
| List own pending | ✓ | ✓ | ✓ |
| List **all** pending in household | ✓ | ✗ | ✗ |
| Get single approved | ✓ | ✓ | ✓ |
| Get single pending (own) | ✓ | ✓ | ✗ |
| Patch (incl. set status) | ✓ | ✗ | ✗ |
| Delete | ✓ | ✗ | ✗ |
| Approve | ✓ | ✗ | ✗ |

Cross-household access is always **404** so existence isn't leaked.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 on manual create with empty name | Pydantic `Field(min_length=1)` | [cookbook/schemas.py](../backend/app/cookbook/schemas.py) |
| 422 on PATCH with empty body | `_at_least_one_field` model validator | [cookbook/schemas.py](../backend/app/cookbook/schemas.py) `RecipeUpdate` |
| 422 on bad ingredient category | `ItemCategory` Literal in `RecipeIngredient` | [items/schemas.py](../backend/app/items/schemas.py) |
| 422 on extract-photo with > 5 MB image | `SCAN_IMAGE_MAX_BASE64` constraint | [items/schemas.py](../backend/app/items/schemas.py) |
| 403 on POST/PATCH/DELETE/approve | Not admin; not in household | [cookbook/router.py](../backend/app/cookbook/router.py) |
| 404 on a recipe you can see | Pending and not own/admin, or cross-household | [cookbook/router.py](../backend/app/cookbook/router.py) `_fetch_recipe_for_caller` |
| 502 on generate / extract-photo | Agent returned `reason` with no `name` | [cookbook/router.py](../backend/app/cookbook/router.py) `generate` / `extract_photo` |
| 500 on import at startup | `ImportError` from `cookbook_agent` / `recipe_photo_agent` — agent folder missing or has dep failure | [main.py](../backend/app/main.py) sys.path loop; the import is module-level so failures crash boot rather than hide |
| Agent crashes on `None` age_group / taste_preferences | AI agent doesn't handle missing values | AI-team-side fix; don't paper over with fake defaults |

---

## What this PR does NOT include (deferred)

- **`recipe_personalized_descriptions` table + endpoint.** No recipe-detail screen yet, so there's nothing to render the per-user description in. When the detail screen lands, that PR adds the table, the cache logic (`generated_at < recipe.updated_at` → stale), and the `GET /cookbook/recipes/{id}/description` endpoint.
- **`recipe_history` table.** Tracks "who ate what when" — populated by meal-plan finalize and consumed by a reactions UI. Both belong in the meal-plan PR.
- **Meal plan integration.** No meal-plan tables, no `/meal-plan/*` endpoints. The AI engineer's plan covers this in her Phases 4–5; the backend won't take that on until the mobile screens are built and the meal-plan agent's contract has been validated.
- **Strict tag enum.** Tags are arbitrary `text[]` today. A future PR can lock them to a known set if needed.

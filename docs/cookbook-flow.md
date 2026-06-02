# Cookbook flow

Per-household recipe book. Three creation paths (Manual / AI Generate / Photo Extract) all feed `public.recipes` through **one save endpoint** (`POST /cookbook/recipes`). The two AI endpoints are pass-through previews — they call the agent and return the proposed recipe without writing anything, then the FE asks the user to confirm before persisting via the save endpoint. Source of truth: [supabase/migrations/0008_init_cookbook.sql](../supabase/migrations/0008_init_cookbook.sql) and [backend/app/cookbook/router.py](../backend/app/cookbook/router.py).

AI agent functions live outside the backend tree under [ai_agents/cookbook-agent/](../ai_agents/cookbook-agent/) and [ai_agents/recipe-photo-agent/](../ai_agents/recipe-photo-agent/); we reach them via the sys.path shim in [backend/app/main.py](../backend/app/main.py).

---

## Resource

`public.recipes` — see [0008_init_cookbook.sql](../supabase/migrations/0008_init_cookbook.sql). Highlights:

- `household_id` — every recipe belongs to exactly one household. Cascades on household delete.
- `name`, `description`, `instructions` — free text with DB-level length checks.
- `ingredients` — JSONB array of `{name, quantity, unit, category}`. `category` validates against the `public.item_category` enum at the app layer.
- `tags` — `text[]` with a GIN index; arbitrary values today (no enum), normalised case-as-typed.
- `source` — one of `manual`, `ai_generated`, `photo`. Set by the FE on save (defaults to `manual`).
- `status` — one of `pending`, `approved`. Set by the backend based on caller role: admin → `approved`, family → `pending`.
- `submitted_by` — `auth.users.id` of the creator, `ON DELETE SET NULL`.

---

## Endpoints

| Method | Path | Caller | Body | Persists? | Notes |
| --- | --- | --- | --- | :---: | --- |
| GET | `/cookbook/recipes` | any member | — | — | Query params: `tag`, `search` (ilike on name), `source`, `status`. Default scope: approved + own pending. |
| POST | `/cookbook/recipes` | any member | `RecipeCreate` | **yes** | Single save endpoint for all three paths. `source` from body (defaults to `manual`). Status = admin → `approved`, family → `pending`. |
| GET | `/cookbook/recipes/{id}` | any member | — | — | 404 cross-household; 404 if pending and not own/admin. |
| PATCH | `/cookbook/recipes/{id}` | admin | `RecipeUpdate` (≥1 field) | yes | Edit any field including `status`. |
| DELETE | `/cookbook/recipes/{id}` | admin | — | yes | Hard delete. |
| POST | `/cookbook/recipes/{id}/approve` | admin | — | yes | Sets `status='approved'`. Idempotent. |
| POST | `/cookbook/recipes/generate` | any member | `GenerateRecipeRequest` | **no** | Pass-through preview. Returns `RecipePreview` (no `id`/`status`). FE saves via `POST /cookbook/recipes` with `source='ai_generated'`. 502 on agent total failure. |
| POST | `/cookbook/recipes/extract-photo` | any member | `ExtractPhotoRequest` | **no** | Pass-through preview. Returns `RecipePreview` with optional `reason` for partial extractions. FE saves via `POST /cookbook/recipes` with `source='photo'`. 502 only on no-name failure. |

---

## The two-step AI flow

```
FE: "Add recipe → AI Generate" tab
  │
  ▼
POST /cookbook/recipes/generate     ──►  agent runs (no DB write)
  ◄─── RecipePreview {name, ingredients, ..., source='ai_generated'}
  │
  ▼
FE: review screen. User edits / discards.
  │
  ├── user cancels  ────────────────►  nothing was ever written
  │
  └── user confirms
        │
        ▼
POST /cookbook/recipes              ──►  one row inserted
  body: {...preview fields..., source: 'ai_generated'}
  ◄─── RecipeOut {id, status, ...}     status = admin → 'approved'
                                                 family → 'pending'
```

Photo extract is identical with `source='photo'`. Manual entry skips the preview step entirely — the FE calls `POST /cookbook/recipes` directly with `source='manual'` (or omits it; that's the default).

This is the same shape as `/items/scan-image` — pass-through to the AI, then a separate save step. It avoids the "double-write" bug where the AI endpoint would create a `pending` row and the FE save endpoint would create a second row for the same recipe.

---

## Approval workflow

One gate. The split is by **caller role**, not by entry method:

| Caller | Resulting status |
| --- | --- |
| Admin (manual / AI / photo) | `approved` |
| Family (manual / AI / photo) | `pending` |

The human reviews on-screen before pressing save, so admin's save doesn't need a second review step. Family submissions still go through admin because the household policy is that admin gates family contributions.

**The submitter sees their own pending row** so they can preview it in their cookbook list before bothering an admin. Other family members don't see it (the SELECT policy filters on `submitted_by = auth.uid()` for non-approved rows).

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

`age_group` and `taste_preferences` are passed as **`None`** because those columns don't exist in our schema. The agent must handle missing values — if it crashes on `None`, that's an AI-team-side fix, not a backend workaround.

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

Backend handling:
- `name` present, `reason` absent → 200 with `RecipePreview`, `reason: null`.
- `name` present, `reason` set → 200 with `RecipePreview`, `reason` populated (FE shows it as a warning above the editable preview). **Description is not auto-annotated** — the FE renders the warning itself.
- `name` absent → **502** with `reason` as the detail message. The FE shows a "generation failed" toast and lets the user retry.

---

## Why 502 on total failure (vs scan-image's 200-always)

`/items/scan-image` returns 200 always with `name: Optional[str]` — total failure is expressed as `{name: null, reason: "..."}` in the body. Cookbook AI is also pass-through, but the FE chose a typed-on-success contract: `RecipePreview.name` is required, so total failure has to be communicated as a non-200 status. That's 502 (agent failed downstream of us).

If you add a third AI pass-through endpoint, pick one of these two shapes consciously and document why. Both are valid; they're just different ergonomics.

---

## Permissions matrix

| Action | admin | family (submitter) | family (other) |
| --- | :---: | :---: | :---: |
| Preview via AI generate / photo extract | ✓ | ✓ | ✓ |
| Save via `POST /cookbook/recipes` (admin → approved; family → pending) | ✓ | ✓ | ✓ |
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
| 422 on save with empty name | Pydantic `Field(min_length=1)` | [cookbook/schemas.py](../backend/app/cookbook/schemas.py) |
| 422 on save with bad `source` | `RecipeSource` Literal — must be one of `manual`/`ai_generated`/`photo` | [cookbook/schemas.py](../backend/app/cookbook/schemas.py) |
| 422 on PATCH with empty body | `_at_least_one_field` model validator | [cookbook/schemas.py](../backend/app/cookbook/schemas.py) `RecipeUpdate` |
| 422 on bad ingredient category | `ItemCategory` Literal in `RecipeIngredient` | [items/schemas.py](../backend/app/items/schemas.py) |
| 422 on extract-photo with > 5 MB image | `SCAN_IMAGE_MAX_BASE64` constraint | [items/schemas.py](../backend/app/items/schemas.py) |
| 403 on PATCH/DELETE/approve | Not admin; not in household | [cookbook/router.py](../backend/app/cookbook/router.py) |
| 404 on a recipe you can see | Pending and not own/admin, or cross-household | [cookbook/router.py](../backend/app/cookbook/router.py) `_fetch_recipe_for_caller` |
| 502 on generate / extract-photo | Agent returned no `name` (with or without `reason`) | [cookbook/router.py](../backend/app/cookbook/router.py) `generate` / `extract_photo` |
| Two rows for one AI generation | FE bug — agent endpoint should be pass-through. If you're tempted to make `/generate` write a row, don't (re-introduces the bug this PR fixed). | — |
| 500 on import at startup | `ImportError` from `cookbook_agent` / `recipe_photo_agent` — agent folder missing or has dep failure | [main.py](../backend/app/main.py) sys.path loop; the import is module-level so failures crash boot rather than hide |
| Agent crashes on `None` age_group / taste_preferences | AI agent doesn't handle missing values | AI-team-side fix; don't paper over with fake defaults |

---

## What this PR does NOT include (deferred)

- **`recipe_personalized_descriptions` table + endpoint.** No recipe-detail screen yet, so there's nothing to render the per-user description in. When the detail screen lands, that PR adds the table, the cache logic (`generated_at < recipe.updated_at` → stale), and the `GET /cookbook/recipes/{id}/description` endpoint.
- **`recipe_history` table.** Tracks "who ate what when" — populated by meal-plan finalize and consumed by a reactions UI. Both belong in the meal-plan finalize PR.
- **Strict tag enum.** Tags are arbitrary `text[]` today. A future PR can lock them to a known set if needed.

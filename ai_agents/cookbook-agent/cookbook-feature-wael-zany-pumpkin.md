# Cookbook + Meal Planning Features

## Background

Wael (mentor) described two features rooted in his personal Sunday cooking ritual — bulk cooking in advance, planning the week based on family preferences, and keeping a household recipe collection. The goal is to help the family decide *what to eat*, not just *what to buy*, and to automate the path from meal decision → grocery list → price optimization.

---

## Shared Decisions (from interview)

| # | Decision |
|---|---|
| 1 | Cookbook is a **persistent household collection** — recipes accumulate over time, AI personalizes descriptions and suggests from it |
| 2 | Any member can **submit** a recipe; admin **approves** via a pending queue before it enters the shared cookbook |
| 3 | Three ways to add a recipe: **manual entry**, **photo of cookbook page** (new vision agent), **AI generation** |
| 4 | Member profiles get two new fields: **age group** (kid/teen/adult/senior) + **free-text preferences** ("hates vegetables, loves spicy food") alongside the existing 5 health toggles |
| 5 | Recipe history is recorded when a recipe appears in a **finalized meal plan** (not when requested) |
| 6 | Family members can leave a **3-option reaction** (Loved it / Okay / Didn't like it) from the plan view |
| 7 | Weekly submission is **one unified screen**: mix cookbook recipe picks + freetext requests + busy days |
| 8 | Meal plan covers **dinners only** |
| 9 | AI can suggest **any meal** — links to a cookbook recipe if one matches, otherwise invents with suggested ingredients; admin can tap "Save to cookbook" on invented meals |
| 10 | Each day in the plan is labeled **Prep / Reheat / Fresh** — visible and editable by admin |
| 11 | Admin edits the plan **day-by-day** before finalizing — swap meals, change labels, edit notes |
| 12 | Finalize → **auto-add ingredients** to existing shopping list (labeled "From meal plan: [week]") + **background price search** |
| 13 | Family members see a **read-only view** of the finalized plan |
| 14 | AI **acknowledges unmet requests** in the plan summary ("Nour's burger request couldn't fit this week…") |
| 15 | No push notifications for now — admin sees **"X/Y members submitted"** count in the UI |

---

## Database Changes (2 migrations)

### Migration 0008 — Cookbook

**New fields on `public.users`:**
```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS age_group TEXT CHECK (age_group IN ('kid','teen','adult','senior')),
  ADD COLUMN IF NOT EXISTS taste_preferences TEXT; -- free-text, e.g. "hates broccoli, loves spicy"
```

**New tables:**

| Table | Key fields |
|---|---|
| `recipes` | id, household_id, name, description (canonical), ingredients (JSONB array of `{name,quantity,unit,category}`), instructions, tags (text[]), prep_minutes, servings, source (`manual`\|`ai_generated`\|`photo`), status (`pending`\|`approved`), submitted_by, created_at, updated_at |
| `recipe_personalized_descriptions` | recipe_id, user_id, description (AI text), generated_at — UNIQUE(recipe_id, user_id); invalidated when recipe.updated_at changes |
| `recipe_history` | id, household_id, recipe_id, user_id, plan_id (FK to meal_plans), reaction (`loved`\|`okay`\|`disliked`), created_at |

**Design notes:**
- `ingredients` JSONB (not a separate table) — always read/written atomically; `category` matches existing `item_category` enum for direct shopping list mapping
- `recipe_personalized_descriptions` is separate so it can be invalidated per-user without touching the recipe row
- `status='pending'` is the default; admin approval sets `status='approved'`

### Migration 0009 — Meal Plan

**New tables:**

| Table | Key fields |
|---|---|
| `meal_plan_submissions` | id, household_id, user_id, week_start (date), busy_days (int[] ISO: 1=Mon–7=Sun), meal_requests (JSONB: `[{description, recipe_id|null}]`), submitted_at — UNIQUE(household_id, user_id, week_start) |
| `meal_plans` | id, household_id, week_start (date), status (`draft`\|`finalized`), ai_summary (text), price_results (JSONB — populated async by price agent), created_by, created_at, updated_at — UNIQUE(household_id, week_start) |
| `meal_plan_days` | id, plan_id, day_of_week (1–7), recipe_id (nullable FK), meal_name, prep_label (`prep`\|`reheat`\|`fresh`), notes, suggested_ingredients (JSONB — populated by AI when no recipe_id exists) — UNIQUE(plan_id, day_of_week) |

**Design notes:**
- `busy_days` is `int[]` not JSONB — domain is exactly 1–7, efficiently queried as PG array
- `suggested_ingredients` on `meal_plan_days` is how invented meals provide ingredients for the shopping list at finalization
- `price_results` on `meal_plans` is populated async by the price agent background task after finalization

All new tables: GRANTs to `service_role` + `authenticated`, RLS using the existing `current_household_id()` helper, `set_updated_at()` trigger on tables with `updated_at`.

---

## Backend API Modules

### `backend/app/cookbook/` (router prefix: `/cookbook`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/cookbook/recipes` | any member | List approved household recipes (filter by tag, search by name) |
| POST | `/cookbook/recipes` | any member | Submit a recipe (status=pending) |
| GET | `/cookbook/recipes/{id}` | any member | Get one recipe |
| PATCH | `/cookbook/recipes/{id}` | admin | Edit recipe fields |
| DELETE | `/cookbook/recipes/{id}` | admin | Delete recipe |
| POST | `/cookbook/recipes/{id}/approve` | admin | Approve a pending recipe |
| POST | `/cookbook/recipes/generate` | admin | AI-generate a recipe from a text prompt |
| POST | `/cookbook/recipes/extract-photo` | any member | Extract recipe from base64 photo (new vision agent) |
| GET | `/cookbook/recipes/{id}/description` | any member | Fetch or generate personalized description for the caller |
| GET | `/cookbook/history` | any member | My recipe history (last N entries with reactions) |
| POST | `/cookbook/history/{recipe_id}/react` | any member | Set reaction on a history entry (loved/okay/disliked) |

### `backend/app/meal_plan/` (router prefix: `/meal-plan`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/meal-plan/submissions` | any member | Upsert the caller's weekly submission (busy days + meal requests) |
| GET | `/meal-plan/submissions/{week_start}` | any (own) / admin (all) | Get submissions for a week |
| GET | `/meal-plan/{week_start}` | any member | Get the plan for a week (draft or finalized) |
| GET | `/meal-plan/{week_start}/submission-count` | admin | How many members have submitted ("3/5") |
| POST | `/meal-plan/generate` | admin | AI-generate a weekly plan from all submissions |
| PATCH | `/meal-plan/{plan_id}/days/{day_id}` | admin | Edit a single day (swap meal, change label, edit notes) |
| POST | `/meal-plan/{plan_id}/finalize` | admin | Finalize plan → auto-add shopping list items → trigger background price search (returns 202) |
| GET | `/meal-plan/{week_start}/prices` | admin | Fetch price results (polled by frontend after finalization) |

---

## AI Agents (3 new agents)

### 1. `ai_agents/cookbook-agent/`

**Entry points:**
```python
def generate_recipe(prompt: str, household_context: dict) -> dict
def personalize_recipe_description(recipe: dict, member_profile: dict, recent_history: list[dict]) -> str
```

### 2. `ai_agents/recipe-photo-agent/`

**Entry point:**
```python
def extract_recipe_from_image(image_base64: str, media_type: str) -> dict
```

### 3. `ai_agents/meal-plan-agent/`

**Entry point:**
```python
def generate_weekly_plan(context: dict) -> dict
```

---

## Phased Implementation Order

| Phase | Scope |
|---|---|
| 1 | Member profile enrichment (age_group + taste_preferences) |
| 2 | Cookbook foundation — CRUD, no AI |
| 3 | Cookbook AI — generate, photo extract, personalized description |
| 4 | Meal plan foundation — submissions, plan CRUD, finalize |
| 5 | Meal plan AI + price search integration |

---

## Critical Reference Files

- `backend/app/low_stock/router.py` — canonical pattern for `_caller_household_id`, `run_in_threadpool`
- `ai_agents/price-agent/price_agent.py` — canonical agent structure: client init, ephemeral caching, JSON pipeline, never-raises
- `store/itemStore.ts` — Zustand store pattern with optimistic updates
- `supabase/migrations/0004_init_items.sql` — migration style: idempotent enums, GRANTs, RLS, trigger
- `app/(family)/home.tsx` — `QuickAction` + `LockedAction` component pattern

---

## Verification

1. **Cookbook manual add:** Family member submits recipe → admin pending queue → admin approves → visible to all
2. **Cookbook photo:** Snap cookbook page → extracted fields pre-populate form → admin approves
3. **Personalized description:** Two members with different profiles view same recipe → descriptions differ
4. **Reaction memory:** Mark "Didn't like it" → next week's AI plan avoids suggesting it
5. **Weekly submission:** Family selects busy days + requests → admin sees "X/Y submitted"
6. **Plan generation:** Admin generates → 7 dinner slots with Prep/Reheat/Fresh labels → AI summary covers all requests
7. **Day editing:** Admin swaps meal on day 3 → updates instantly
8. **Finalize:** Shopping list items appear labeled "From meal plan" → prices appear after background search
9. **Family plan view:** Read-only 7-day schedule → can react per day

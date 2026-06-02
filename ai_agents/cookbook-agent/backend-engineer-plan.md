# Backend Engineer Plan — Cookbook + Meal Planning

> Companion plans: [ai-engineer-plan.md](ai-engineer-plan.md) | [frontend-engineer-plan.md](frontend-engineer-plan.md)
> Master decisions: [cookbook-feature-wael-zany-pumpkin.md](cookbook-feature-wael-zany-pumpkin.md)

---

## Your Responsibility

- Supabase database migrations
- FastAPI route modules: `cookbook/` and `meal_plan/`
- Updates to existing modules: `me/`, `household/`
- Wiring AI agent calls into routes via `run_in_threadpool()`
- Shopping list auto-population at plan finalization
- Background price search task

**You do NOT write AI agents** — the AI engineer delivers entry-point functions you call.
**You do NOT build screens** — the frontend engineer calls your endpoints.

---

## Reference Files (read these before starting)

- `backend/app/low_stock/router.py` — canonical router pattern, `_caller_household_id` helper, `run_in_threadpool` usage
- `backend/app/items/schemas.py` — `item_category` enum values your agents must align with
- `supabase/migrations/0004_init_items.sql` — exact migration style: idempotent enums, GRANTs, RLS with `current_household_id()`, `set_updated_at()` trigger
- `backend/app/auth/deps.py` — `current_user`, `require_role` dependencies
- `backend/app/main.py` — where you register new routers

---

## Phase 1 — Member Profile Enrichment

### Migration: add to `users` table

**File:** `supabase/migrations/0008_user_profile_enrichment.sql`

```sql
alter table public.users
  add column if not exists age_group text
    check (age_group in ('kid', 'teen', 'adult', 'senior')),
  add column if not exists taste_preferences text
    check (char_length(taste_preferences) <= 500);
```

### `me/schemas.py` — add to `ProfileUpdate` and `MeUser`

```python
age_group: Optional[Literal['kid', 'teen', 'adult', 'senior']] = None
taste_preferences: Optional[str] = Field(None, max_length=500)
```

### `household/schemas.py` — add to `CreateMemberRequest`, `UpdateMemberRequest`, `MemberRow`, `CreateMemberResponse`

Same two optional fields. Admin sets them when creating/editing a family member.

### `me/router.py` + `household/router.py`

Include the new fields in the Supabase `UPDATE` calls and `SELECT` projections. No other changes.

---

## Phase 2 — Cookbook Module (no AI)

### Migration: `supabase/migrations/0009_init_cookbook.sql`

```sql
-- Enums
do $$ begin
  create type public.recipe_source as enum ('manual', 'ai_generated', 'photo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recipe_status as enum ('pending', 'approved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recipe_reaction as enum ('loved', 'okay', 'disliked');
exception when duplicate_object then null; end $$;

-- recipes table
create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 200),
  description   text,
  ingredients   jsonb not null default '[]'::jsonb,
  -- [{name: text, quantity: text, unit: text, category: item_category}]
  instructions  text,
  tags          text[] not null default '{}',
  prep_minutes  int check (prep_minutes > 0),
  servings      int check (servings > 0),
  source        public.recipe_source not null default 'manual',
  status        public.recipe_status not null default 'pending',
  submitted_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists recipes_household_status_idx on public.recipes(household_id, status);

-- recipe_personalized_descriptions table
create table if not exists public.recipe_personalized_descriptions (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  description  text not null,
  generated_at timestamptz not null default now(),
  unique (recipe_id, user_id)
);

-- recipe_history table
create table if not exists public.recipe_history (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  plan_id      uuid,  -- FK to meal_plans added after migration 0010
  reaction     public.recipe_reaction,
  created_at   timestamptz not null default now()
);

create index if not exists rh_user_recipe_idx on public.recipe_history(user_id, recipe_id);

-- GRANTs
grant select, insert, update, delete on public.recipes to service_role;
grant select, insert, update, delete on public.recipe_personalized_descriptions to service_role;
grant select, insert, update, delete on public.recipe_history to service_role;
grant select on public.recipes to authenticated;
grant select on public.recipe_personalized_descriptions to authenticated;
grant select on public.recipe_history to authenticated;

-- RLS
alter table public.recipes enable row level security;
alter table public.recipe_personalized_descriptions enable row level security;
alter table public.recipe_history enable row level security;

-- All household members see approved recipes + their own pending
create policy recipes_select on public.recipes for select to authenticated
  using (
    household_id = public.current_household_id()
    and (status = 'approved' or submitted_by = auth.uid())
  );

-- Personalized descriptions: each user sees only their own
create policy rpd_select_own on public.recipe_personalized_descriptions for select to authenticated
  using (user_id = auth.uid());

-- History: user sees own; admin sees all in household
create policy rh_select on public.recipe_history for select to authenticated
  using (
    user_id = auth.uid()
    or (
      household_id = public.current_household_id()
      and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
    )
  );

-- updated_at trigger
drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();
```

### Module: `backend/app/cookbook/`

Create `__init__.py`, `schemas.py`, `router.py`.

**`schemas.py` key types:**

```python
class RecipeIngredient(BaseModel):
    name: str
    quantity: str
    unit: str
    category: ItemCategory  # import from items.schemas

class RecipeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    ingredients: list[RecipeIngredient] = []
    instructions: Optional[str] = None
    tags: list[str] = []
    prep_minutes: Optional[int] = Field(None, gt=0)
    servings: Optional[int] = Field(None, gt=0)
    source: Literal['manual', 'ai_generated', 'photo'] = 'manual'

class RecipeUpdate(BaseModel):
    # all Optional, model_validator requires at_least_one — same pattern as ItemUpdate

class RecipeOut(BaseModel):
    id: UUID
    household_id: UUID
    name: str
    description: Optional[str]
    ingredients: list[RecipeIngredient]
    instructions: Optional[str]
    tags: list[str]
    prep_minutes: Optional[int]
    servings: Optional[int]
    source: str
    status: str
    submitted_by: Optional[UUID]
    created_at: datetime
    updated_at: datetime

class GenerateRecipeRequest(BaseModel):
    prompt: str = Field(..., min_length=5, max_length=500)
    tag_hints: list[str] = []

class ExtractPhotoRequest(BaseModel):
    image_base64: str
    media_type: Literal['image/jpeg', 'image/png', 'image/webp']

class ReactRequest(BaseModel):
    reaction: Literal['loved', 'okay', 'disliked']
```

**`router.py` endpoints — Phase 2 (no AI):**

```
GET  /cookbook/recipes              → list approved recipes (+ own pending)
POST /cookbook/recipes              → submit recipe (status=pending, submitted_by=caller)
GET  /cookbook/recipes/{id}         → get one recipe
PATCH /cookbook/recipes/{id}        → admin: edit fields
DELETE /cookbook/recipes/{id}       → admin: delete
POST /cookbook/recipes/{id}/approve → admin: set status='approved'
GET  /cookbook/history              → caller's history (last 20)
POST /cookbook/history/{recipe_id}/react → upsert reaction
```

Use `_caller_household_id(user, sb)` helper — copy directly from `low_stock/router.py`.

---

## Phase 3 — Cookbook AI Endpoints

**AI agent status:**
- ✅ `generate_recipe` — delivered (`ai_agents/cookbook-agent/cookbook_agent.py`)
- ✅ `personalize_recipe_description` — delivered (`ai_agents/cookbook-agent/cookbook_agent.py`)
- ✅ `extract_recipe_from_image` — delivered (`ai_agents/recipe-photo-agent/recipe_photo_agent.py`)

**Import pattern — two separate agents, two separate path inserts:**
```python
import sys
from pathlib import Path
from starlette.concurrency import run_in_threadpool

# cookbook agent (generate + personalize)
sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'cookbook-agent'))
from cookbook_agent import generate_recipe, personalize_recipe_description

# recipe photo agent (extract from image)
sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'recipe-photo-agent'))
from recipe_photo_agent import extract_recipe_from_image
```

**Add endpoints:**
```
POST /cookbook/recipes/generate      → admin: call generate_recipe() via run_in_threadpool
POST /cookbook/recipes/extract-photo → any member: call extract_recipe_from_image() → insert as pending
GET  /cookbook/recipes/{id}/description → check cache; if stale regenerate via personalize_recipe_description()
```

**Cache invalidation:** `recipe_personalized_descriptions.generated_at < recipe.updated_at` → stale, regenerate.

---

### Confirmed contract: `generate_recipe`

```python
result = await run_in_threadpool(generate_recipe, prompt, household_context)
```

`household_context` — construct from Supabase before calling:
```python
members_res = sb.table('users') \
    .select('display_name,age_group,taste_preferences,health_preferences') \
    .eq('household_id', household_id).execute()

household_context = {
    'tag_hints': request.tag_hints,          # list[str] from GenerateRecipeRequest
    'household_members': members_res.data,   # list of user rows as dicts
}
```

`household_members` row shape (Supabase returns this directly):
```python
{
    'display_name': 'Ahmed',
    'age_group': 'kid',
    'taste_preferences': 'hates broccoli',
    'health_preferences': {          # jsonb column — comes back as dict
        'high_protein': False,
        'low_calories': False,
        'low_carbs': False,
        'low_sugar': True,
        'whole_grain': False,
    }
}
```

Return shape — same as `RecipeOut` minus `id`, `household_id`, `source`, `status`, `submitted_by`, `created_at`, `updated_at`:
```python
{
    'name': str | None,
    'description': str | None,
    'ingredients': [{'name': str, 'quantity': str, 'unit': str, 'category': str}],
    'instructions': str | None,
    'tags': list[str],
    'prep_minutes': int | None,
    'servings': int | None,
    'reason': str | None,   # None on success — check this before saving
}
```

**Error handling:** if `result['reason'] is not None`, the agent failed — raise `HTTPException(status_code=502, detail=result['reason'])`. Do not insert a broken recipe into the database.

---

### Confirmed contract: `personalize_recipe_description`

```python
description = await run_in_threadpool(
    personalize_recipe_description, recipe, member_profile, recent_history
)
```

`member_profile` — query the calling user:
```python
user_res = sb.table('users') \
    .select('display_name,age_group,taste_preferences,health_preferences') \
    .eq('id', str(caller.user_id)).single().execute()

member_profile = user_res.data  # pass the dict directly
```

`recent_history` — query then transform (Supabase join result needs reshaping):
```python
history_res = sb.table('recipe_history') \
    .select('reaction, created_at, recipes(name)') \
    .eq('user_id', str(caller.user_id)) \
    .order('created_at', desc=True).limit(5).execute()

recent_history = [
    {
        'recipe_name': row['recipes']['name'],
        'eaten_on': row['created_at'][:10],   # ISO date string YYYY-MM-DD
        'reaction': row['reaction'],
    }
    for row in history_res.data
]
```

Return: plain `str` — never raises. Returns `""` on agent failure. If the returned string is empty, still cache it (avoids hammering the agent on every request for a bad recipe).

---

### Confirmed contract: `extract_recipe_from_image`

```python
result = await run_in_threadpool(extract_recipe_from_image, request.image_base64, request.media_type)
```

Input — pass directly from `ExtractPhotoRequest` body:
- `image_base64`: raw base64 string — **no data URI prefix**. The frontend must strip `data:image/jpeg;base64,` before sending if using a browser file reader.
- `media_type`: one of `"image/jpeg"`, `"image/png"`, `"image/webp"`

Return shape — identical to `generate_recipe`:
```python
{
    'name': str | None,
    'description': str | None,
    'ingredients': [{'name': str, 'quantity': str, 'unit': str, 'category': str}],
    'instructions': str | None,
    'tags': list[str],
    'prep_minutes': int | None,
    'servings': int | None,
    'reason': str | None,
}
```

**Two result cases to handle:**

| Condition | Meaning | Action |
|---|---|---|
| `reason is not None` and `name is None` | Agent failed (API error or bad image) | Raise `HTTPException(502)` |
| `reason is not None` and `name is not None` | Partial extraction (some fields missing from the photo) | Save the recipe; store `reason` in a log or `description` field as a note |
| `reason is None` | Full extraction success | Save normally |

**Model note:** Uses `claude-haiku-4-5-20251001` (vision) — not Sonnet. Cost is ~$0.008 per image vs. ~$0.05 for Sonnet. The backend does not control the model; the agent file does.

---

## Phase 4 — Meal Plan Module (no AI)

### Migration: `supabase/migrations/0010_init_meal_plan.sql`

```sql
do $$ begin
  create type public.meal_plan_status as enum ('draft', 'finalized');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.prep_label as enum ('prep', 'reheat', 'fresh');
exception when duplicate_object then null; end $$;

create table if not exists public.meal_plan_submissions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  week_start    date not null,
  busy_days     int[] not null default '{}',  -- ISO: 1=Mon, 7=Sun
  meal_requests jsonb not null default '[]'::jsonb,
  -- [{description: text, recipe_id: uuid|null}]
  submitted_at  timestamptz not null default now(),
  unique (household_id, user_id, week_start)
);

create table if not exists public.meal_plans (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  week_start    date not null,
  status        public.meal_plan_status not null default 'draft',
  ai_summary    text,
  price_results jsonb,  -- populated async after finalization
  created_by    uuid not null references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, week_start)
);

create table if not exists public.meal_plan_days (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references public.meal_plans(id) on delete cascade,
  day_of_week           int not null check (day_of_week between 1 and 7),
  recipe_id             uuid references public.recipes(id) on delete set null,
  meal_name             text not null check (char_length(meal_name) between 1 and 200),
  prep_label            public.prep_label not null default 'fresh',
  notes                 text,
  suggested_ingredients jsonb default '[]'::jsonb,
  unique (plan_id, day_of_week)
);

-- Also add FK from recipe_history to meal_plans
alter table public.recipe_history
  add constraint if not exists rh_plan_id_fk
  foreign key (plan_id) references public.meal_plans(id) on delete set null;

-- GRANTs + RLS + trigger (same pattern as other migrations)
```

### Module: `backend/app/meal_plan/`

**`router.py` endpoints — Phase 4 (no AI):**

```
POST /meal-plan/submissions               → upsert caller's submission
GET  /meal-plan/submissions/{week_start}  → own or all (admin)
GET  /meal-plan/{week_start}/count        → {"submitted": N, "total": M}
GET  /meal-plan/{week_start}              → MealPlanOut with days[]
PATCH /meal-plan/{plan_id}/days/{day_id} → admin: edit day
POST /meal-plan/{plan_id}/react          → family: upsert recipe_history reaction
```

Upsert pattern for submissions:
```python
sb.table('meal_plan_submissions').upsert(
    payload,
    on_conflict='household_id,user_id,week_start'
).execute()
```

---

## Phase 5 — Meal Plan AI + Finalization

**Dependency on AI engineer:** Receive `generate_weekly_plan(context) -> dict`

**Add endpoints:**
```
POST /meal-plan/generate       → admin: assemble context, call agent, upsert plan + days
POST /meal-plan/{id}/finalize  → admin: finalize + auto-add shopping list + background price search (202)
GET  /meal-plan/{week}/prices  → admin: fetch price_results (frontend polls this)
```

**Finalize endpoint logic:**
1. Set `status='finalized'`
2. Load all `meal_plan_days` — collect ingredients from `recipes.ingredients` (if `recipe_id` set) or `suggested_ingredients` (if invented)
3. Deduplicate + aggregate by ingredient name
4. Insert directly into `items` table: `status='pending'`, `notes='From meal plan: {week_start}'`, `added_by=admin_id`
5. Insert `recipe_history` rows for each day that has a `recipe_id`
6. Fire background task: `search_grocery_prices(item_names, store_urls)` → store in `meal_plans.price_results`

**Background price task:**
```python
def _price_search_task(plan_id: str, item_names: list, store_urls: list):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'price-agent'))
    from price_agent import search_grocery_prices
    results = search_grocery_prices(item_names, store_urls)
    get_supabase().table('meal_plans').update({'price_results': results}).eq('id', plan_id).execute()
```

### Register in `main.py`

```python
from .cookbook.router import router as cookbook_router
from .meal_plan.router import router as meal_plan_router
app.include_router(cookbook_router)
app.include_router(meal_plan_router)
```

---

## Verification Checklist

- [ ] `GET /cookbook/recipes` returns only approved recipes + caller's own pending
- [ ] `POST /cookbook/recipes/{id}/approve` requires admin role; 403 for family
- [ ] `POST /cookbook/recipes/generate` returns recipe with valid `category` values
- [ ] `GET /cookbook/recipes/{id}/description` returns cached description if not stale; regenerates if stale
- [ ] `POST /meal-plan/submissions` upserts correctly (second submit same week replaces first)
- [ ] `GET /meal-plan/{week}/count` returns correct submitted/total ratio
- [ ] `POST /meal-plan/{id}/finalize` inserts items into `items` table with correct `notes` field
- [ ] After finalize, `GET /items` shows new items with "From meal plan: ..." notes
- [ ] `GET /meal-plan/{week}/prices` returns null immediately, then populates after background task
- [ ] All new endpoints return 401 for unauthenticated, 403 for wrong role

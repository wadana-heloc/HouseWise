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
    check (char_length(taste_preferences) <= 500),
  add column if not exists health_preferences jsonb not null default
    '{"high_protein": false, "low_calories": false, "low_carbs": false, "low_sugar": false, "whole_grain": false}'::jsonb;
```

`health_preferences` is a required field for all 3 AI agents — the cookbook, photo, and meal plan agents all read it from the member profile. It must be present with a valid default for every existing user row.

### `me/schemas.py` — add to `ProfileUpdate` and `MeUser`

```python
class HealthPreferences(BaseModel):
    high_protein: bool = False
    low_calories: bool = False
    low_carbs: bool = False
    low_sugar: bool = False
    whole_grain: bool = False

# Add to ProfileUpdate and MeUser:
age_group: Optional[Literal['kid', 'teen', 'adult', 'senior']] = None
taste_preferences: Optional[str] = Field(None, max_length=500)
health_preferences: Optional[HealthPreferences] = None
```

### `household/schemas.py` — add to `CreateMemberRequest`, `UpdateMemberRequest`, `MemberRow`, `CreateMemberResponse`

Same three optional fields. Admin sets them when creating/editing a family member.

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

**Save logic after successful call:**
```python
insert_payload = {
    'household_id': household_id,
    'name': result['name'],
    'description': result['description'],
    'ingredients': result['ingredients'],   # list of dicts — stored as jsonb
    'instructions': result['instructions'],
    'tags': result['tags'],
    'prep_minutes': result['prep_minutes'],
    'servings': result['servings'],
    'source': 'ai_generated',
    'status': 'pending',                    # admin must approve before it appears in cookbook
    'submitted_by': str(user.user_id),
}
saved = sb.table('recipes').insert(insert_payload).execute()
return RecipeOut(**saved.data[0])
```

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

**Save logic — upsert into `recipe_personalized_descriptions`:**
```python
sb.table('recipe_personalized_descriptions').upsert(
    {
        'recipe_id': recipe_id,
        'user_id': str(caller.user_id),
        'description': description,         # empty string is valid — still cache it
        'generated_at': datetime.utcnow().isoformat(),
    },
    on_conflict='recipe_id,user_id'         # unique constraint — update if exists
).execute()
```

**Cache read logic — check before calling agent:**
```python
cached = sb.table('recipe_personalized_descriptions') \
    .select('description, generated_at') \
    .eq('recipe_id', recipe_id) \
    .eq('user_id', str(caller.user_id)) \
    .single().execute()

recipe = sb.table('recipes').select('updated_at').eq('id', recipe_id).single().execute()

# Stale if cache predates the last recipe edit
if cached.data and cached.data['generated_at'] >= recipe.data['updated_at']:
    return {'description': cached.data['description'], 'generated_at': cached.data['generated_at']}

# Otherwise fall through to agent call + upsert above
```

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

**Save logic after successful call:**
```python
# Partial extraction: save what was found, append reason as a note in description
description = result['description'] or ''
if result['reason']:
    description = f"{description}\n\nExtraction note: {result['reason']}".strip()

insert_payload = {
    'household_id': household_id,
    'name': result['name'],
    'description': description,
    'ingredients': result['ingredients'],
    'instructions': result['instructions'],
    'tags': result['tags'],
    'prep_minutes': result['prep_minutes'],
    'servings': result['servings'],
    'source': 'photo',
    'status': 'pending',                    # admin must review and approve
    'submitted_by': str(user.user_id),
}
saved = sb.table('recipes').insert(insert_payload).execute()
return RecipeOut(**saved.data[0])
```

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

-- GRANTs
grant select, insert, update, delete on public.meal_plan_submissions to service_role;
grant select, insert, update, delete on public.meal_plans to service_role;
grant select, insert, update, delete on public.meal_plan_days to service_role;
grant select, insert on public.meal_plan_submissions to authenticated;
grant select on public.meal_plans to authenticated;
grant select on public.meal_plan_days to authenticated;

-- RLS
alter table public.meal_plan_submissions enable row level security;
alter table public.meal_plans enable row level security;
alter table public.meal_plan_days enable row level security;

-- Submissions: user sees/edits own; admin sees all in household
create policy mps_select on public.meal_plan_submissions for select to authenticated
  using (
    user_id = auth.uid()
    or (
      household_id = public.current_household_id()
      and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
    )
  );

-- Meal plans: all household members can view
create policy mp_select on public.meal_plans for select to authenticated
  using (household_id = public.current_household_id());

-- Meal plan days: all household members can view (via parent plan)
create policy mpd_select on public.meal_plan_days for select to authenticated
  using (
    exists (
      select 1 from public.meal_plans
      where id = plan_id and household_id = public.current_household_id()
    )
  );

-- updated_at trigger
drop trigger if exists meal_plans_set_updated_at on public.meal_plans;
create trigger meal_plans_set_updated_at
  before update on public.meal_plans
  for each row execute function public.set_updated_at();
```

### Module: `backend/app/meal_plan/`

**`schemas.py` key types:**

```python
class MealRequest(BaseModel):
    description: str
    recipe_id: Optional[UUID] = None

class SubmissionUpsert(BaseModel):
    week_start: date
    busy_days: list[int] = []              # ISO weekday: 1=Mon, 7=Sun
    meal_requests: list[MealRequest] = []

class MealPlanDayOut(BaseModel):
    id: UUID
    plan_id: UUID
    day_of_week: int                       # 1–7
    recipe_id: Optional[UUID]
    meal_name: str
    prep_label: str                        # 'prep' | 'reheat' | 'fresh'
    notes: Optional[str]
    # suggested_ingredients NOT exposed to frontend — backend-only for shopping list

class MealPlanOut(BaseModel):
    id: UUID
    household_id: UUID
    week_start: date
    status: str                            # 'draft' | 'finalized'
    ai_summary: Optional[str]
    price_results: Optional[dict]          # null until background task completes
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    days: list[MealPlanDayOut] = []

class MealPlanSubmissionOut(BaseModel):
    id: UUID
    user_id: UUID
    week_start: date
    busy_days: list[int]
    meal_requests: list[MealRequest]
    submitted_at: datetime

class SubmissionCountOut(BaseModel):
    submitted: int
    total: int

class DayUpdate(BaseModel):               # admin edits a day after plan is generated
    meal_name: Optional[str] = None
    prep_label: Optional[str] = None
    notes: Optional[str] = None
    recipe_id: Optional[UUID] = None
```

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

**AI agent status:** ✅ `generate_weekly_plan` — delivered (`ai_agents/meal-plan-agent/meal_plan_agent.py`)

**Import pattern:**
```python
sys.path.insert(0, str(Path(__file__).parents[3] / 'ai_agents' / 'meal-plan-agent'))
from meal_plan_agent import generate_weekly_plan
```

**Add endpoints:**
```
POST /meal-plan/generate       → admin: assemble context, call agent, upsert plan + days
POST /meal-plan/{id}/finalize  → admin: finalize + auto-add shopping list + background price search (202)
GET  /meal-plan/{week}/prices  → admin: fetch price_results (frontend polls this)
```

---

### Confirmed contract: `generate_weekly_plan`

```python
result = await run_in_threadpool(generate_weekly_plan, context)
```

`context` — assemble from Supabase before calling:
```python
# 1. Members with their submissions for this week
members_res = sb.table('users') \
    .select('id,display_name,age_group,taste_preferences,health_preferences') \
    .eq('household_id', household_id).execute()

submissions_res = sb.table('meal_plan_submissions') \
    .select('user_id,busy_days,meal_requests') \
    .eq('household_id', household_id) \
    .eq('week_start', week_start).execute()

# dict[str, dict] — index submissions by user_id for fast lookup
submissions_by_user = {s['user_id']: s for s in submissions_res.data}

# 2. Merge member profile with their submission
household_members = [
    {
        'display_name': m['display_name'],
        'age_group': m['age_group'],
        'taste_preferences': m['taste_preferences'],
        'health_preferences': m['health_preferences'],
        'busy_days': submissions_by_user.get(m['id'], {}).get('busy_days', []),
        'meal_requests': submissions_by_user.get(m['id'], {}).get('meal_requests', []),
    }
    for m in members_res.data
]

# 3. Available recipes — trimmed to what Claude needs (no full ingredient lists)
recipes_res = sb.table('recipes') \
    .select('id,name,tags,prep_minutes,ingredients') \
    .eq('household_id', household_id) \
    .eq('status', 'approved').execute()

available_recipes = [
    {
        'id': r['id'],
        'name': r['name'],
        'tags': r['tags'],
        'prep_minutes': r['prep_minutes'],
        'ingredient_categories': list({ing['category'] for ing in r['ingredients']}),
    }
    for r in recipes_res.data
]

# 4. Last week's meal names — prevents repeating recipes week after week
prev_week_start = (date.fromisoformat(week_start) - timedelta(days=7)).isoformat()
prev_days_res = sb.table('meal_plan_days') \
    .select('meal_name, meal_plans!inner(week_start, household_id)') \
    .eq('meal_plans.household_id', household_id) \
    .eq('meal_plans.week_start', prev_week_start).execute()
last_week_meals = [row['meal_name'] for row in prev_days_res.data]

# 5. Low stock items
low_stock_res = sb.table('items') \
    .select('name') \
    .eq('household_id', household_id) \
    .eq('status', 'low_stock').execute()
low_stock_items = [row['name'] for row in low_stock_res.data]

context = {
    'week_start': week_start,
    'household_members': household_members,
    'available_recipes': available_recipes,
    'low_stock_items': low_stock_items,
    'last_week_meals': last_week_meals,
}
```

Return shape:
```python
{
    'ai_summary': str | None,
    'days': [
        {
            'day_of_week': int,          # 1=Mon through 7=Sun, always exactly 7 entries
            'recipe_id': str | None,     # None when Claude invented the meal
            'meal_name': str,
            'prep_label': str,           # 'prep' | 'reheat' | 'fresh'
            'notes': str | None,
            'suggested_ingredients': [   # only populated when recipe_id is None
                {'name': str, 'quantity': str, 'unit': str, 'category': str}
            ],
        }
    ],
    'reason': str | None,                # None on success, error string on failure
}
```

**Error handling:** if `result['reason'] is not None` and `result['days']` is empty → raise `HTTPException(status_code=502, detail=result['reason'])`.

**Save logic after successful call:**
```python
# Upsert plan row (re-generating replaces existing draft for the same week)
plan_res = sb.table('meal_plans').upsert(
    {
        'household_id': household_id,
        'week_start': week_start,
        'status': 'draft',
        'ai_summary': result['ai_summary'],
        'created_by': str(user.user_id),
    },
    on_conflict='household_id,week_start'
).execute()

plan_id = plan_res.data[0]['id']

# Delete existing days before re-inserting (avoids unique constraint conflicts on day_of_week)
sb.table('meal_plan_days').delete().eq('plan_id', plan_id).execute()

# Insert all 7 days
days_payload = [
    {
        'plan_id': plan_id,
        'day_of_week': day['day_of_week'],
        'recipe_id': day['recipe_id'],
        'meal_name': day['meal_name'],
        'prep_label': day['prep_label'],
        'notes': day['notes'],
        'suggested_ingredients': day['suggested_ingredients'],  # stored as jsonb, used at finalize
    }
    for day in result['days']
]
sb.table('meal_plan_days').insert(days_payload).execute()
```

**Shopping list population on finalize — two sources:**

| Day type | Where ingredients come from |
|---|---|
| `recipe_id` is set | Join `meal_plan_days → recipes → ingredients` in the database |
| `recipe_id` is None | Use `meal_plan_days.suggested_ingredients` (agent-generated) |

Never ask the agent to re-output cookbook recipe ingredients — they are already in the database.

---

**Finalize endpoint logic — exact steps:**

```python
# Step 1: mark plan as finalized
sb.table('meal_plans').update({'status': 'finalized'}).eq('id', plan_id).execute()

# Step 2: load all days with their linked recipe ingredients
days_res = sb.table('meal_plan_days') \
    .select('recipe_id, suggested_ingredients, recipes(ingredients)') \
    .eq('plan_id', plan_id).execute()

# Step 3: collect all ingredients from both sources
all_ingredients = []
for day in days_res.data:
    if day['recipe_id'] and day['recipes']:
        all_ingredients.extend(day['recipes']['ingredients'])   # from cookbook
    else:
        all_ingredients.extend(day['suggested_ingredients'])    # agent-generated

# Step 4: deduplicate by name (aggregate quantities for same-name items)
# dict[str, dict] — keyed by ingredient name
aggregated = {}
for ing in all_ingredients:
    key = ing['name'].lower().strip()
    if key not in aggregated:
        aggregated[key] = {**ing}
    # (quantity aggregation optional — simplest approach is just deduplicate by name)

# Step 5: insert into items table
items_payload = [
    {
        'household_id': household_id,
        'name': ing['name'],
        'category': ing['category'],
        'status': 'pending',
        'notes': f'From meal plan: {week_start}',
        'added_by': str(user.user_id),
    }
    for ing in aggregated.values()
]
if items_payload:
    sb.table('items').insert(items_payload).execute()

# Step 6: insert recipe_history rows for each day that has a recipe_id
history_rows = [
    {
        'household_id': household_id,
        'recipe_id': day['recipe_id'],
        'user_id': str(user.user_id),
        'plan_id': plan_id,
        'reaction': None,                   # filled later when member reacts
    }
    for day in days_res.data
    if day['recipe_id'] is not None
]
if history_rows:
    sb.table('recipe_history').insert(history_rows).execute()

# Step 7: fire background price search (returns 202 immediately)
item_names = [ing['name'] for ing in aggregated.values()]
background_tasks.add_task(_price_search_task, plan_id, item_names, store_urls)
```

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

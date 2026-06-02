-- 0009_init_meal_plan.sql
-- Per-household weekly meal plans. Submissions feed the AI generator; the
-- generated plan is one row in `meal_plans` plus exactly 7 rows in
-- `meal_plan_days`. Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. Enums
-- ============================================================

-- Pre-add the 'finalized' value even though this PR only writes 'draft' —
-- saves an enum migration when the finalize flow lands with its UI.
do $$ begin
  create type public.meal_plan_status as enum ('draft', 'finalized');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.prep_label as enum ('prep', 'reheat', 'fresh');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. Tables
-- ============================================================

create table if not exists public.meal_plan_submissions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  week_start    date not null,
  busy_days     int[] not null default '{}',
  -- ISO weekday: 1=Mon..7=Sun. Range / dedupe enforced in Pydantic.
  meal_requests jsonb not null default '[]'::jsonb,
  -- [{description: text<=300, recipe_id: uuid|null}]
  submitted_at  timestamptz not null default now(),
  unique (household_id, user_id, week_start)
);

create table if not exists public.meal_plans (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start   date not null,
  status       public.meal_plan_status not null default 'draft',
  ai_summary   text check (ai_summary is null or char_length(ai_summary) <= 2000),
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, week_start)
);

create table if not exists public.meal_plan_days (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references public.meal_plans(id) on delete cascade,
  day_of_week           int not null check (day_of_week between 1 and 7),
  recipe_id             uuid references public.recipes(id) on delete set null,
  meal_name             text not null check (char_length(meal_name) between 1 and 200),
  prep_label            public.prep_label not null default 'fresh',
  notes                 text check (notes is null or char_length(notes) <= 1000),
  suggested_ingredients jsonb not null default '[]'::jsonb,
  -- Stored even though unused this PR — the finalize PR reads it to build
  -- the shopping list for agent-invented meals (recipe_id is null).
  unique (plan_id, day_of_week)
);

create index if not exists mps_household_week_idx
  on public.meal_plan_submissions(household_id, week_start);
create index if not exists mp_household_week_idx
  on public.meal_plans(household_id, week_start);

-- ============================================================
-- 3. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.meal_plan_submissions to service_role;
grant select, insert, update, delete on public.meal_plans              to service_role;
grant select, insert, update, delete on public.meal_plan_days          to service_role;
grant select on public.meal_plan_submissions to authenticated;
grant select on public.meal_plans              to authenticated;
grant select on public.meal_plan_days          to authenticated;

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.meal_plan_submissions enable row level security;
alter table public.meal_plans              enable row level security;
alter table public.meal_plan_days          enable row level security;

drop policy if exists mps_select on public.meal_plan_submissions;
create policy mps_select on public.meal_plan_submissions
  for select to authenticated
  using (household_id = public.current_household_id());

drop policy if exists mp_select on public.meal_plans;
create policy mp_select on public.meal_plans
  for select to authenticated
  using (household_id = public.current_household_id());

drop policy if exists mpd_select on public.meal_plan_days;
create policy mpd_select on public.meal_plan_days
  for select to authenticated
  using (exists (
    select 1 from public.meal_plans
    where id = plan_id and household_id = public.current_household_id()
  ));

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key.

-- ============================================================
-- 5. updated_at trigger (reuses public.set_updated_at from 0001)
-- ============================================================

drop trigger if exists meal_plans_set_updated_at on public.meal_plans;
create trigger meal_plans_set_updated_at
  before update on public.meal_plans
  for each row execute function public.set_updated_at();

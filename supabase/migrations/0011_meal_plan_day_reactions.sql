-- 0011_meal_plan_day_reactions.sql
-- Per-day reactions on finalized meal plans. One row per (day_id, user_id).
-- Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. Enum
-- ============================================================
-- Two states only (FE confirmed: no neutral middle). Day-scoped, not
-- recipe-scoped — see docs/meal-plan-flow.md for why this differs from the
-- AI engineer's original `recipe_reaction` design.

do $$ begin
  create type public.meal_plan_reaction as enum ('liked', 'disliked');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. Table
-- ============================================================
-- Keyed on day_id (which always exists) rather than recipe_id (nullable when
-- the agent invented the meal). ON DELETE CASCADE on day_id wipes reactions
-- automatically when a plan is re-generated; reactions on PRIOR plans
-- survive because their days survive.

create table if not exists public.meal_plan_day_reactions (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.meal_plan_days(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reaction   public.meal_plan_reaction not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_id, user_id)
);

create index if not exists mpdr_day_idx on public.meal_plan_day_reactions(day_id);

-- ============================================================
-- 3. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.meal_plan_day_reactions to service_role;
grant select on public.meal_plan_day_reactions to authenticated;

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.meal_plan_day_reactions enable row level security;

drop policy if exists mpdr_select on public.meal_plan_day_reactions;
create policy mpdr_select on public.meal_plan_day_reactions
  for select to authenticated
  using (exists (
    select 1
    from public.meal_plan_days d
    join public.meal_plans p on p.id = d.plan_id
    where d.id = day_id and p.household_id = public.current_household_id()
  ));

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key.

-- ============================================================
-- 5. updated_at trigger (reuses public.set_updated_at from 0001)
-- ============================================================

drop trigger if exists mpdr_set_updated_at on public.meal_plan_day_reactions;
create trigger mpdr_set_updated_at
  before update on public.meal_plan_day_reactions
  for each row execute function public.set_updated_at();

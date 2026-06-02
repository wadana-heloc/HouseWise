-- 0008_init_cookbook.sql
-- Per-household recipes (manual / AI-generated / photo-extracted).
-- Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. Enums
-- ============================================================

do $$ begin
  create type public.recipe_source as enum ('manual', 'ai_generated', 'photo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recipe_status as enum ('pending', 'approved');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. Table
-- ============================================================

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  ingredients jsonb not null default '[]'::jsonb,
  -- Each element: {name, quantity, unit, category} where category is one of the
  -- public.item_category enum values; validation lives in Pydantic at the app layer.
  instructions text check (instructions is null or char_length(instructions) <= 10000),
  tags text[] not null default '{}',
  prep_minutes int check (prep_minutes is null or prep_minutes > 0),
  servings int check (servings is null or servings > 0),
  source public.recipe_source not null default 'manual',
  status public.recipe_status not null default 'pending',
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_household_status_idx on public.recipes(household_id, status);
create index if not exists recipes_tags_gin_idx on public.recipes using gin (tags);

-- ============================================================
-- 3. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.recipes to service_role;
grant select on public.recipes to authenticated;

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.recipes enable row level security;

drop policy if exists recipes_select_visible on public.recipes;
create policy recipes_select_visible on public.recipes
  for select to authenticated
  using (
    household_id = public.current_household_id()
    and (status = 'approved' or submitted_by = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key.

-- ============================================================
-- 5. updated_at trigger (reuses public.set_updated_at from 0001)
-- ============================================================

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- 0004_init_items.sql
-- Household shopping/inventory items.
-- Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. Enums
-- ============================================================

do $$ begin
  create type public.item_category as enum (
    'dairy', 'meat', 'grains', 'bakery', 'pantry',
    'produce', 'frozen', 'drinks', 'cleaning', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.item_unit as enum (
    'units', 'kg', 'g', 'L', 'ml', 'packs', 'loaves', 'bottles', 'cans', 'bags'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.item_status as enum (
    'pending', 'in_review', 'approved', 'rejected', 'done'
  );
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. Table
-- ============================================================

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  category public.item_category not null,
  quantity numeric(10,3) not null default 1 check (quantity > 0),
  unit public.item_unit not null,
  urgent boolean not null default false,
  status public.item_status not null default 'pending',
  notes text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_household_id_idx on public.items(household_id);
create index if not exists items_household_status_idx on public.items(household_id, status);
create index if not exists items_household_urgent_idx on public.items(household_id) where urgent;

-- ============================================================
-- 3. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.items to service_role;
grant select on public.items to authenticated;

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.items enable row level security;

drop policy if exists items_select_same_household on public.items;
create policy items_select_same_household on public.items
  for select to authenticated
  using (household_id = public.current_household_id());

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key.

-- ============================================================
-- 5. updated_at trigger (reuses public.set_updated_at from 0001)
-- ============================================================

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

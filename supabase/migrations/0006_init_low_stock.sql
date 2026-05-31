-- 0006_init_low_stock.sql
-- Per-household low-stock flags. One flag per (household, name).
-- Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. Table
-- ============================================================

create table if not exists public.low_stock_flags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists low_stock_flags_household_id_idx
  on public.low_stock_flags(household_id);

-- Case-insensitive uniqueness: one flag per name per household,
-- regardless of who flagged it. Re-flagging an existing name -> 409.
create unique index if not exists low_stock_flags_unique_per_household_idx
  on public.low_stock_flags (household_id, lower(name));

-- ============================================================
-- 2. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.low_stock_flags to service_role;
grant select on public.low_stock_flags to authenticated;

-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.low_stock_flags enable row level security;

drop policy if exists low_stock_flags_select_same_household on public.low_stock_flags;
create policy low_stock_flags_select_same_household on public.low_stock_flags
  for select to authenticated
  using (household_id = public.current_household_id());

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key.

-- ============================================================
-- 4. updated_at trigger (reuses public.set_updated_at from 0001)
-- ============================================================

drop trigger if exists low_stock_flags_set_updated_at on public.low_stock_flags;
create trigger low_stock_flags_set_updated_at
  before update on public.low_stock_flags
  for each row execute function public.set_updated_at();

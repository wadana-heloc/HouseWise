-- 0007_init_stores.sql
-- Per-household stores (admin-managed; readable by all household members).
-- Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. Table
-- ============================================================

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  url text not null,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stores_household_id_idx on public.stores(household_id);

-- Case-insensitive uniqueness: one store per name per household.
create unique index if not exists stores_unique_per_household_idx
  on public.stores (household_id, lower(name));

-- ============================================================
-- 2. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.stores to service_role;
grant select on public.stores to authenticated;

-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.stores enable row level security;

drop policy if exists stores_select_same_household on public.stores;
create policy stores_select_same_household on public.stores
  for select to authenticated
  using (household_id = public.current_household_id());

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key; admin-only at the application layer.

-- ============================================================
-- 4. updated_at trigger (reuses public.set_updated_at from 0001)
-- ============================================================

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

-- 0015_to_buy_list.sql
-- Per-household "what we're buying this trip" list. Frozen buying decisions
-- with the price snapshot at the moment admin saved them. Distinct from
-- public.items (the open active list); a to_buy_list row references a single
-- items row by FK. Bidirectional sync with items.status='done' lives in the
-- application layer (see backend/app/to_buy/router.py and items/router.py).
--
-- Also adds public.households.last_report_sent_at for cron idempotency
-- (set by the future shopping-report cron after a successful send).
--
-- Paste into the Supabase SQL Editor and run once. Idempotent.

-- ============================================================
-- 1. public.to_buy_list
-- ============================================================

create table if not exists public.to_buy_list (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  chosen_store_url text not null,
  chosen_store_name text not null,
  chosen_price numeric(10,2) not null check (chosen_price >= 0),
  currency text not null default 'AED' check (char_length(currency) <= 8),
  snapshot_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one to-buy entry per item per household — replace-on-regenerate enforces this
  unique (household_id, item_id)
);

create index if not exists tbl_household_idx on public.to_buy_list(household_id);

grant select, insert, update, delete on public.to_buy_list to service_role;
grant select on public.to_buy_list to authenticated;

alter table public.to_buy_list enable row level security;

drop policy if exists tbl_select on public.to_buy_list;
create policy tbl_select on public.to_buy_list
  for select to authenticated
  using (household_id = public.current_household_id());

drop trigger if exists tbl_set_updated_at on public.to_buy_list;
create trigger tbl_set_updated_at before update on public.to_buy_list
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. public.households.last_report_sent_at (cron idempotency)
-- ============================================================
-- Updated by the shopping-report cron after a successful send so the same
-- household isn't emailed twice in one scheduled window. Nullable; never
-- sent before = NULL.

alter table public.households
  add column if not exists last_report_sent_at timestamptz;

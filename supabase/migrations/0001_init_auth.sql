-- 0001_init_auth.sql
-- Initial auth schema: households + users, GRANTs, RLS starter policies.
-- Paste this whole file into Supabase SQL Editor and run once.

-- ============================================================
-- 1. Tables
-- ============================================================

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists households_admin_id_idx on public.households(admin_id);

do $$ begin
  create type public.user_role as enum ('admin', 'family');
exception when duplicate_object then null; end $$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  role public.user_role not null,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_household_id_idx on public.users(household_id);

-- ============================================================
-- 2. GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant usage on schema public to service_role, authenticated, anon;

grant select, insert, update, delete on public.households to service_role;
grant select, insert, update, delete on public.users      to service_role;

grant select on public.households to authenticated;
grant select on public.users      to authenticated;

-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.households enable row level security;
alter table public.users      enable row level security;

drop policy if exists households_select_own on public.households;
create policy households_select_own on public.households
  for select to authenticated
  using (id = (select household_id from public.users where id = auth.uid()));

drop policy if exists users_select_same_household on public.users;
create policy users_select_same_household on public.users
  for select to authenticated
  using (household_id = (select household_id from public.users where id = auth.uid()));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT/DELETE policies for `authenticated`. All creates/destroys
-- go through the backend with the service_role key.

-- ============================================================
-- 4. updated_at trigger
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists households_set_updated_at on public.households;
create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. auth.users -> public.users seed trigger
-- ============================================================
-- Inserts a stub row in public.users whenever a new auth.users row is created,
-- so the backend's follow-up UPDATE (per spec §7.1 / §7.6) always has a row to hit.
-- household_id stays NULL until the backend sets it in the same request.
-- Role is read from app_metadata; defaults to 'admin' for the signup path.

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text;
  meta_display_name text;
begin
  meta_role := coalesce(new.raw_app_meta_data ->> 'role', 'admin');
  meta_display_name := coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1));

  insert into public.users (id, role, display_name, email)
  values (new.id, meta_role::public.user_role, meta_display_name, new.email)
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 0002_fix_rls_recursion.sql
-- Fix infinite recursion in users/households SELECT policies.
--
-- The policies in 0001 referenced public.users from inside a policy ON public.users
-- (and from households' policy, which the users policy then re-triggered).
-- Postgres re-evaluates the policy on the inner SELECT -> infinite recursion (42P17).
--
-- Fix: move the self-lookup into a SECURITY DEFINER function, which runs as the
-- function owner and is exempt from the caller's RLS. The function is STABLE so
-- the planner can cache it within a statement.

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.users where id = auth.uid()
$$;

revoke all on function public.current_household_id() from public;
grant execute on function public.current_household_id() to authenticated;

drop policy if exists users_select_same_household on public.users;
create policy users_select_same_household on public.users
  for select to authenticated
  using (household_id = public.current_household_id());

drop policy if exists households_select_own on public.households;
create policy households_select_own on public.households
  for select to authenticated
  using (id = public.current_household_id());

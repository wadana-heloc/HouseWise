-- 0003_reset_and_simplify_auth.sql
--
-- ============================================================
-- *** DESTRUCTIVE ***  CONFIRM BEFORE RUNNING.
-- ============================================================
-- Wipes ALL households, ALL public.users, and ALL auth.users
-- (which cascades through auth.identities/sessions/refresh_tokens/etc).
-- Run only when you have agreed that existing accounts in this
-- Supabase project should disappear.
-- ============================================================
--
-- Ordering matters:
--   public.households.admin_id REFERENCES auth.users(id) ON DELETE RESTRICT
--     -> households must go BEFORE auth.users.
--   public.users.id           REFERENCES auth.users(id)   ON DELETE CASCADE
--   public.users.household_id REFERENCES public.households(id) ON DELETE CASCADE
--     -> public.users empties via CASCADE; the explicit delete is a defensive sweep.
--
-- GoTrue's auth.identities / auth.sessions / auth.refresh_tokens /
-- auth.mfa_factors / auth.one_time_tokens / auth.flow_state all FK-cascade
-- to auth.users, so the single `delete from auth.users` clears them.
-- auth.audit_log_entries is intentionally unlinked; leave it alone.

begin;
  delete from public.households;
  delete from public.users;
  delete from auth.users;
commit;

-- ============================================================
-- Harden users_update_self: a logged-in member must not be able
-- to UPDATE their own role or household_id via direct PostgREST.
-- Backend writes go through service_role and bypass RLS.
-- ============================================================

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.users where id = auth.uid())
    and household_id is not distinct from (select household_id from public.users where id = auth.uid())
  );

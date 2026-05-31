-- 0005_user_profile_and_health_prefs.sql
-- Adds per-user health-preference toggles. Idempotent.
-- The application layer pins the known key set ('high_protein', 'low_calories',
-- 'low_carbs', 'low_sugar', 'whole_grain') via Pydantic with extra='forbid'.
-- New preferences can be added by changing the Pydantic schema only.

alter table public.users
  add column if not exists health_preferences jsonb not null default '{}'::jsonb;

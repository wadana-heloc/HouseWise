-- 0010_dietary_prefs_and_week_notes.sql
-- Per-user dietary preferences (set once, flow into every meal plan) and a
-- per-submission free-text week_notes field. Paste into the Supabase SQL
-- Editor and run once. Idempotent.

-- ============================================================
-- 1. users.dietary_preferences (JSONB)
-- ============================================================
-- Shape: {"dietary_types": text[], "allergies": text[], "dislikes": text[]}
-- Shape enforced at the Pydantic layer (DietaryPreferences / Update); FE
-- owns the dietary_types vocabulary (free-text, not a strict enum).

alter table public.users
  add column if not exists dietary_preferences jsonb not null default
    '{"dietary_types": [], "allergies": [], "dislikes": []}'::jsonb;

-- ============================================================
-- 2. meal_plan_submissions.week_notes (text, nullable)
-- ============================================================
-- Per-submission note ("hosting Friday, need easy meals"). Visible to
-- submitter via GET /meal-plan/submissions/me; flows into the agent
-- context on POST /meal-plan/generate.

alter table public.meal_plan_submissions
  add column if not exists week_notes text
    check (week_notes is null or char_length(week_notes) <= 2000);

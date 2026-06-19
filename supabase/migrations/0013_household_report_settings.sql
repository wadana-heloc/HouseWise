-- 0013_household_report_settings.sql
-- Per-household weekly shopping report schedule. Three new columns on
-- public.households; existing rows are backfilled with sane defaults via
-- the column DEFAULT clauses. Paste into the Supabase SQL Editor and run
-- once. Idempotent.

-- ============================================================
-- 1. report_day (ISO weekday, 1=Mon..7=Sun)
-- ============================================================
-- ISO matches meal_plan_submissions.busy_days. The FE shows Sunday-first
-- (US convention) — that's a display-side mapping.

alter table public.households
  add column if not exists report_day smallint not null default 7
    check (report_day between 1 and 7);

-- ============================================================
-- 2. report_time (wall-clock 24h "HH:MM")
-- ============================================================
-- Interpreted in report_timezone (below). Regex enforces HH:MM with
-- 00–23 hours and 00–59 minutes; FE's 5-minute-step rule is FE-only.

alter table public.households
  add column if not exists report_time text not null default '09:00'
    check (report_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ============================================================
-- 3. report_timezone (IANA name, e.g. 'Asia/Beirut')
-- ============================================================
-- App-layer validation uses Python's stdlib zoneinfo so the DB check is
-- only a length sanity bound. FE supplies the value from
-- Intl.DateTimeFormat().resolvedOptions().timeZone on first PATCH; until
-- then, households default to 'UTC'.

alter table public.households
  add column if not exists report_timezone text not null default 'UTC'
    check (char_length(report_timezone) between 1 and 64);

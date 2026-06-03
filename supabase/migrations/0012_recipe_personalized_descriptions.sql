-- 0012_recipe_personalized_descriptions.sql
-- Per-user cache for AI-generated personalized recipe descriptions. Keyed
-- on (recipe_id, user_id). Staleness is "cached.generated_at < recipe.updated_at"
-- — checked in the app layer, not at the DB. Paste into the Supabase SQL
-- Editor and run once. Idempotent.

create table if not exists public.recipe_personalized_descriptions (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  description  text not null,
  generated_at timestamptz not null default now(),
  unique (recipe_id, user_id)
);

create index if not exists rpd_recipe_user_idx
  on public.recipe_personalized_descriptions(recipe_id, user_id);

-- ============================================================
-- GRANTs (required even though service_role bypasses RLS)
-- ============================================================

grant select, insert, update, delete on public.recipe_personalized_descriptions to service_role;
grant select on public.recipe_personalized_descriptions to authenticated;

-- ============================================================
-- RLS — personal data, not even other household members can read someone
-- else's description via PostgREST. Backend bypasses via service_role for
-- the cache lookup.
-- ============================================================

alter table public.recipe_personalized_descriptions enable row level security;

drop policy if exists rpd_select_own on public.recipe_personalized_descriptions;
create policy rpd_select_own on public.recipe_personalized_descriptions
  for select to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through
-- the backend with the service_role key.

-- No updated_at trigger — we use `generated_at` directly as the staleness
-- signal against recipes.updated_at.

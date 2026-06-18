-- 0014_recipe_story.sql
-- Optional narrative field on a recipe — origin story, family note, etc.
-- Distinct from recipe_personalized_descriptions (migration 0012), which is
-- per-user AI-generated; `story` is the same for everyone and manually
-- authored. Paste into the Supabase SQL Editor and run once. Idempotent.

alter table public.recipes
  add column if not exists story text
    check (story is null or char_length(story) between 1 and 5000);

comment on column public.recipes.story is
  'Optional narrative paragraph for the recipe (origin, family note, etc.). '
  'Nullable; 1..5000 chars when present. Manually authored — AI generate / '
  'photo extract endpoints do not populate this field.';

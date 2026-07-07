-- Taken Kings — leaderboard schema
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- Design: one row per validated run. Four boards distinguished by `board`.
--   hs_classic -> High Score, Classic setup   -> value = Taken Kings  (higher is better)
--   hs_rolled  -> High Score, Rolled setup    -> value = Taken Kings  (higher is better)
--   hs_15s     -> High Score, 15s Timer mode   -> value = Taken Kings  (higher is better)
--   speedrun   -> Fastest to 25 Kings          -> value = milliseconds (LOWER is better)
--
-- Security (serious anti-cheat): clients may only READ. All inserts go through a
-- validating Edge Function using the service_role key, which bypasses RLS — so we
-- deliberately grant NO insert/update/delete policy to anon/authenticated.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  board      text not null check (board in ('hs_classic', 'hs_rolled', 'hs_15s', 'speedrun')),
  name       text not null check (char_length(trim(name)) between 1 and 20),
  value      integer not null check (value >= 0),
  seed       bigint,               -- run seed, for reproducibility / replay
  run        jsonb,                -- optional: {setup, timedMode, inputs[]} for replay & re-validation
  created_at timestamptz not null default now()
);

-- Fast "top N for a board" queries (asc covers speedrun; desc covers the others via reverse scan).
create index if not exists scores_board_value_idx on public.scores (board, value);

alter table public.scores enable row level security;

-- Anyone (anon) may read every board.
drop policy if exists "public read scores" on public.scores;
create policy "public read scores" on public.scores for select using (true);

-- NOTE: no insert/update/delete policies on purpose. Writes are server-only.

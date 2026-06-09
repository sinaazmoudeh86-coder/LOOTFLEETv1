-- =============================================================================
--  Loot Fleet — Supabase schema (cloud saves)
--  Run this in your Supabase project: Dashboard → SQL Editor → New query → Run.
-- =============================================================================

-- One save row per player, owned by their auth user.
create table if not exists public.saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock it down so each player can only ever touch their own row.
alter table public.saves enable row level security;

drop policy if exists "saves_select_own" on public.saves;
drop policy if exists "saves_insert_own" on public.saves;
drop policy if exists "saves_update_own" on public.saves;

create policy "saves_select_own" on public.saves
  for select using (auth.uid() = user_id);

create policy "saves_insert_own" on public.saves
  for insert with check (auth.uid() = user_id);

create policy "saves_update_own" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
--  OPTIONAL — a public leaderboard fed from cloud saves.
--  Exposes only non-sensitive fields. Uncomment to enable, then have the client
--  read from `public.leaderboard` instead of the simulated board.
-- =============================================================================
-- create or replace view public.leaderboard as
--   select
--     coalesce(data->>'name', 'Operator')      as name,
--     (data->>'level')::int                     as level,
--     (data->>'highestDungeonReached')::int     as zone,
--     (data->>'totalKills')::bigint             as kills,
--     updated_at
--   from public.saves
--   order by (data->>'level')::int desc nulls last
--   limit 100;
-- grant select on public.leaderboard to anon, authenticated;

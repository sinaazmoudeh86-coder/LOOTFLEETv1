-- =============================================================================
--  discord-art-fields.sql — LOOTFLEET · real game art in the Discord feed
--  ---------------------------------------------------------------------------
--  The feed could already see that a pilot's hull COUNT went up, that their
--  Legendary Nanocore count went up, and that they made another delivery. What
--  it could not see was WHICH hull, WHICH core, or WHICH freighter — so it had
--  nothing to hang real art on and fell back to stock GIFs.
--
--  Three columns close that. All nullable with safe defaults, so an old client
--  that never sends them keeps working and simply posts without art.
--
--    hull_last    text  — ship key of the most recently earned hull
--                         ('dread3', 'voidmaw', …) → ships/ship-<key>.png
--    nano_last    text  — ship key the newest Legendary Nanocore belongs to
--    cargo_tier   int   — tier (1–5) of the last SUCCESSFUL delivery
--                         → ships/cargo-<tier>.png
--
--  The map location for a tile capture needs NO column: tile ids are 'q,r' and
--  the feed already mirrors the client's deterministic tile generator, so ring,
--  coordinates and level band are all derived server-side from the id.
--
--  SAFE TO RE-RUN. Every statement is guarded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · columns on the real leaderboard
-- ---------------------------------------------------------------------------
alter table public.leaderboard add column if not exists hull_last  text;
alter table public.leaderboard add column if not exists nano_last  text;
alter table public.leaderboard add column if not exists cargo_tier smallint default 0;

-- Keep the text columns short — they are ship keys, not free text. A bad client
-- cannot bloat the row or smuggle markup into a Discord embed through them.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leaderboard_hull_last_len') then
    alter table public.leaderboard
      add constraint leaderboard_hull_last_len check (hull_last is null or length(hull_last) <= 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leaderboard_nano_last_len') then
    alter table public.leaderboard
      add constraint leaderboard_nano_last_len check (nano_last is null or length(nano_last) <= 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leaderboard_cargo_tier_rng') then
    alter table public.leaderboard
      add constraint leaderboard_cargo_tier_rng check (cargo_tier is null or (cargo_tier >= 0 and cargo_tier <= 5));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · the same columns on the simulated pilots, so bots never break the diff
-- ---------------------------------------------------------------------------
-- The feed reads sim_pilots through the same shape as real rows. Without these
-- the select fails (or silently drops the fields) the moment the function asks
-- for them by name.
alter table public.sim_pilots add column if not exists hull_last  text;
alter table public.sim_pilots add column if not exists nano_last  text;
alter table public.sim_pilots add column if not exists cargo_tier smallint default 0;

-- ---------------------------------------------------------------------------
-- 3 · let the publish RPC carry them through
-- ---------------------------------------------------------------------------
-- The canonical upsert takes a jsonb payload of extra fields (lb-upsert-canonical
-- .sql). If yours whitelists column names, add the three below to that list.
-- This block is a no-op when the function already passes extras through
-- generically — it only reports what it found, so nothing is clobbered.
do $$
declare
  src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lb_upsert'
   limit 1;
  if src is null then
    raise notice 'lb_upsert not found — publish path may write the table directly; nothing to change.';
  elsif src like '%hull_last%' then
    raise notice 'lb_upsert already handles hull_last — no change needed.';
  else
    raise notice 'ACTION MAY BE NEEDED: lb_upsert exists and does not mention hull_last. If it whitelists columns, add hull_last, nano_last and cargo_tier to it.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · verify
-- ---------------------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('leaderboard', 'sim_pilots')
   and column_name in ('hull_last', 'nano_last', 'cargo_tier')
 order by table_name, column_name;

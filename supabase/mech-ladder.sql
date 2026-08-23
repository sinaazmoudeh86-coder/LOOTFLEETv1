-- =============================================================================
--  mech-ladder.sql — THE MECH FOUNDRY BOARD
--  ---------------------------------------------------------------------------
--  Adds `mech_cores` to public.leaderboard and republishes lb_upsert carrying it.
--
--  THIS FILE IS NOW THE CANONICAL lb_upsert. It is a strict SUPERSET of
--  pilot-ladder.sql: same parameters, same order, same types, ONE more on the end.
--  Re-running new-ladders.sql, pilot-ladder.sql, cargo-ladder.sql,
--  nanocore-ladder.sql or discord-art-publish.sql re-adds an older overload and
--  requires re-running THIS file afterwards.
--
--  `p_power` and `p_kills` are numeric ON PURPOSE. Endgame fleet power passes
--  1e29, bigint tops out near 9.22e18, and JS serialises numbers that large in
--  exponential notation which no integer type parses. Any future migration
--  touching lb_upsert must declare them numeric.
--
--  create or replace CANNOT replace an overload whose argument types differ — it
--  silently adds a second copy, and PostgREST then either picks the wrong
--  candidate or refuses to pick (PGRST203). So step 2 drops EVERY existing
--  overload by catalogue lookup and step 4 asserts exactly one survives.
--
--  WHAT THE BOARD MEASURES: lifetime Mech Cores EARNED (state.mech.earned), never
--  the spendable wallet. A wallet drops when a pilot assembles a hull, and a
--  ladder whose rows fall when you play it is a ladder that punishes playing.
--  Earned only ever climbs, which is why the column is written with greatest().
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. the column -----------------------------------------------------------
alter table public.leaderboard
  add column if not exists mech_cores bigint not null default 0;

-- bigint is right here and numeric is not: cores are earned in the thousands per
-- run and a career total lands in the millions — nowhere near the bigint ceiling,
-- and an integer type keeps the ORDER BY cheap on the one column this board sorts.

-- ---- 2. drop EVERY existing overload by catalogue lookup ---------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'lb_upsert'
  loop
    execute 'drop function ' || r.sig::text;
  end loop;
end $$;

-- ---- 3. the one true lb_upsert ----------------------------------------------
create function public.lb_upsert(
  p_name         text,
  p_power        numeric,
  p_level        int,
  p_zone         int,
  p_kills        numeric,
  p_fleet        int,
  p_asc_stars    int    default 0,
  p_tiles        int    default 0,
  p_citadels     int    default 0,
  p_tile_rev     bigint default 0,
  p_ships        int    default 0,
  p_missions     int    default 0,
  p_badges       int    default 0,
  p_cargo        int    default 0,
  p_cargo_best   int    default 0,
  p_nano_legend  int    default 0,
  p_nano_slots   int    default 0,
  p_nano_god     int    default 0,
  p_hcwave       int    default 0,
  p_expo         int    default 0,
  p_expo_best    int    default 0,
  p_pilot_score  bigint default 0,
  p_pilot_nodes  int    default 0,
  p_mech_cores   bigint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;

  insert into public.leaderboard as l (
    user_id, name, power, level, zone, kills, fleet, asc_stars,
    tiles, citadels, tile_rev, ships, missions, badges,
    cargo, cargo_best, nano_legend, nano_slots, nano_god,
    hcwave, expo, expo_best, pilot_score, pilot_nodes, mech_cores, updated_at
  ) values (
    auth.uid(), p_name, p_power, p_level, p_zone, p_kills, p_fleet, p_asc_stars,
    p_tiles, p_citadels, p_tile_rev, p_ships, p_missions, p_badges,
    p_cargo, p_cargo_best, p_nano_legend, p_nano_slots, p_nano_god,
    p_hcwave, p_expo, p_expo_best, p_pilot_score, p_pilot_nodes, p_mech_cores, now()
  )
  on conflict (user_id) do update set
    name        = excluded.name,
    power       = excluded.power,
    level       = excluded.level,
    zone        = excluded.zone,
    kills       = excluded.kills,
    fleet       = excluded.fleet,
    asc_stars   = excluded.asc_stars,
    tiles       = excluded.tiles,
    citadels    = excluded.citadels,
    tile_rev    = excluded.tile_rev,
    ships       = excluded.ships,
    missions    = excluded.missions,
    badges      = excluded.badges,
    cargo       = excluded.cargo,
    cargo_best  = greatest(l.cargo_best, excluded.cargo_best),
    nano_legend = excluded.nano_legend,
    nano_slots  = excluded.nano_slots,
    nano_god    = excluded.nano_god,
    hcwave      = greatest(l.hcwave, excluded.hcwave),
    expo        = excluded.expo,
    expo_best   = greatest(l.expo_best, excluded.expo_best),
    -- MONOTONIC BY DESIGN. A pilot tree cannot be refunded and Mech Cores earned
    -- cannot be un-earned, so both climb only. This also means a stale client
    -- publishing an old figure cannot knock a row backwards.
    pilot_score = greatest(l.pilot_score, excluded.pilot_score),
    pilot_nodes = greatest(l.pilot_nodes, excluded.pilot_nodes),
    mech_cores  = greatest(l.mech_cores, excluded.mech_cores),
    updated_at  = now()
  where l.user_id = auth.uid();
end $$;

revoke all on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, int, bigint, int, int, int,
  int, int, int, int, int, int, int, int, bigint, int, bigint
) from public, anon;
grant execute on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, int, bigint, int, int, int,
  int, int, int, int, int, int, int, int, bigint, int, bigint
) to authenticated;

-- ---- 4. assert exactly one copy survives ------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'lb_upsert';
  if n <> 1 then
    raise exception 'lb_upsert has % copies — expected exactly 1. Two copies mean PostgREST picks the wrong candidate or refuses to pick (PGRST203).', n;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---- verify -----------------------------------------------------------------
select 'lb_upsert copies' as check,
       (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'lb_upsert') as copies,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'leaderboard'
           and column_name = 'mech_cores') as mech_cores_column;

select name, mech_cores
  from public.leaderboard
 where mech_cores > 0
 order by mech_cores desc
 limit 10;

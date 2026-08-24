-- =============================================================================
--  cmdr-ladder.sql — THE COMMAND RANK BOARD
--  ---------------------------------------------------------------------------
--  Adds `cmdr_score bigint` and `cmdr_line jsonb` to public.leaderboard and
--  republishes lb_upsert carrying both.
--
--  THIS FILE IS NOW THE CANONICAL lb_upsert. It is a strict SUPERSET of
--  mech-ladder.sql — same parameters, same order, same types, TWO more on the
--  end. Re-running new-ladders.sql, pilot-ladder.sql, mech-ladder.sql,
--  cargo-ladder.sql, nanocore-ladder.sql or discord-art-publish.sql re-adds an
--  older overload and requires re-running THIS file afterwards.
--
--  `p_power` and `p_kills` stay numeric ON PURPOSE. Endgame fleet power passes
--  1e29, bigint tops out near 9.22e18, and JS serialises numbers that large in
--  exponential notation which no integer type parses.
--
--  create or replace CANNOT replace an overload whose argument types differ — it
--  silently adds a second copy, and PostgREST then picks the wrong candidate or
--  refuses to pick (PGRST203). So step 2 drops EVERY existing overload by
--  catalogue lookup and step 4 asserts exactly one survives.
--
--  WHY cmdr_line IS jsonb AND NOT A COUNT: the board draws the actual seated
--  officers the way the power board draws hulls, so it needs the ids and the
--  rarity each is held at. It is capped at five entries client-side (the bench
--  can never exceed the fleet), so the column stays small.
--
--  cmdr_score is NOT monotonic. Unlike crowns or cores earned, a roster can
--  legitimately go DOWN — standing an officer down, or switching flagship so a
--  specialist stops paying, both lower it honestly. Writing it with greatest()
--  would freeze a player at their best-ever line-up and make the board a record
--  of what they once fielded rather than what they are fielding.
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. the columns ----------------------------------------------------------
alter table public.leaderboard
  add column if not exists cmdr_score bigint not null default 0;
alter table public.leaderboard
  add column if not exists cmdr_line  jsonb  not null default '[]'::jsonb;

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
  p_mech_cores   bigint default 0,
  p_cmdr_score   bigint default 0,
  p_cmdr_line    jsonb  default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;

  insert into public.leaderboard as l (
    user_id, name, power, level, zone, kills, asc_stars,
    tiles, citadels, tile_rev, ships, missions, badges,
    cargo, cargo_best, nano_legend, nano_slots, nano_god,
    hcwave, expo, expo_best, pilot_score, pilot_nodes, mech_cores,
    cmdr_score, cmdr_line, updated_at
  ) values (
    auth.uid(), p_name, p_power, p_level, p_zone, p_kills, p_asc_stars,
    p_tiles, p_citadels, p_tile_rev, p_ships, p_missions, p_badges,
    p_cargo, p_cargo_best, p_nano_legend, p_nano_slots, p_nano_god,
    p_hcwave, p_expo, p_expo_best, p_pilot_score, p_pilot_nodes, p_mech_cores,
    p_cmdr_score, coalesce(p_cmdr_line, '[]'::jsonb), now()
  )
  on conflict (user_id) do update set
    name        = excluded.name,
    power       = excluded.power,
    level       = excluded.level,
    zone        = excluded.zone,
    kills       = excluded.kills,
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
    -- MONOTONIC: a pilot tree cannot be refunded and cores earned cannot be
    -- un-earned, so a stale client cannot knock either backwards.
    pilot_score = greatest(l.pilot_score, excluded.pilot_score),
    pilot_nodes = greatest(l.pilot_nodes, excluded.pilot_nodes),
    mech_cores  = greatest(l.mech_cores, excluded.mech_cores),
    -- LIVE, NOT MONOTONIC: standing an officer down or switching flagship
    -- legitimately lowers a Command Score, and the board should say so.
    cmdr_score  = excluded.cmdr_score,
    cmdr_line   = coalesce(excluded.cmdr_line, '[]'::jsonb),
    updated_at  = now()
  where l.user_id = auth.uid();
end $$;

revoke all on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, bigint, int, int, int,
  int, int, int, int, int, int, int, int, bigint, int, bigint, bigint, jsonb
) from public, anon;
grant execute on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, bigint, int, int, int,
  int, int, int, int, int, int, int, int, bigint, int, bigint, bigint, jsonb
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

-- ---- 5. PROVE THE FUNCTION CAN ACTUALLY WRITE -------------------------------
-- The 42804 failure was invisible until a client tried to publish, because
-- creating a function does not type-check its body against the table. This runs
-- the real insert path once, inside a transaction that is rolled back, so a
-- column/param mismatch surfaces HERE instead of silently killing every publish.
do $$
begin
  begin
    perform public.lb_upsert('__typecheck__', 1::numeric, 1, 1, 1::numeric);
    raise exception 'ROLLBACK_TYPECHECK_OK';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_TYPECHECK_OK' then
        raise exception 'lb_upsert body does not match the table: %', sqlerrm;
      end if;
  end;
end $$;

-- ---- 6. REPAIR THE ROWS THE BROKEN VERSION ALREADY EMPTIED ------------------
-- Anyone who published while p_fleet defaulted to '[]' had their hull list
-- overwritten with an empty array. The list is client-owned and is re-sent on the
-- next publish, so nothing is permanently lost — but an empty array is TRUTHY in
-- leaderboard.js (`if (p._fleet) return p._fleet`), which short-circuits the
-- generated fallback and renders no ships at all rather than falling back.
--
-- Setting the empties to NULL restores that fallback immediately, and the real
-- list overwrites it the moment that pilot's client publishes again.
update public.leaderboard
   set fleet = null
 where fleet is not null
   and jsonb_typeof(fleet) = 'array'
   and jsonb_array_length(fleet) = 0;

-- ---- verify -----------------------------------------------------------------
select 'lb_upsert copies' as check,
       (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'lb_upsert') as copies,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'leaderboard'
           and column_name in ('mech_cores','cmdr_score','cmdr_line')) as new_columns;

select name, cmdr_score, jsonb_array_length(cmdr_line) as seated
  from public.leaderboard
 where cmdr_score > 0
 order by cmdr_score desc
 limit 10;

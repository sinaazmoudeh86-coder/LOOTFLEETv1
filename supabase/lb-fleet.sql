-- =============================================================================
--  lb-fleet.sql — PUT THE HULL LIST BACK ON THE LEADERBOARD ROW
--  ---------------------------------------------------------------------------
--  THIS FILE IS NOW THE CANONICAL lb_upsert. It declares EVERY parameter the
--  client sends on its widest rung — 29 of them — and step 6 proves it.
--  Re-running cmdr-ladder.sql, mech-ladder.sql, pilot-ladder.sql,
--  new-ladders.sql, cargo-ladder.sql, nanocore-ladder.sql or
--  discord-art-publish.sql re-adds a narrower overload and requires re-running
--  THIS file afterwards.
--
--  WHAT WAS BROKEN
--  `leaderboard.fleet` is the hull list the Ranks power board draws next to each
--  pilot's name. mech-ladder.sql declared `p_fleet int` against a jsonb column,
--  which failed every insert with 42804 and took down publishing for ALL boards;
--  the repair removed p_fleet from the client payload and from the function
--  signature entirely. That fixed publishing and left the column ORPHANED: no
--  migration since has written `fleet`, and no client has sent it.
--
--  So every row's fleet array has been frozen since that day — '[]' for the
--  accounts that published while the bad version was live, and a hull list from
--  build ~688 for everyone else. cmdr-ladder.sql's closing note claims "every row
--  repairs itself the moment that pilot's client publishes again". That is not
--  true and cannot be: nothing publishes it. This file is the write path.
--
--  AND THE THREE ART FIELDS WERE MISSING TOO
--  The first draft of this file was built as a superset of cmdr-ladder.sql, which
--  is a superset of mech-ladder.sql, and so on down the chain — and NONE of them
--  ever declared p_hull_last / p_nano_last / p_cargo_tier, even though the client
--  has merged the `art` payload into every rung since discord-art-publish.sql
--  shipped. lb_upsert enumerates its parameters, so three undeclared keys mean
--  PostgREST cannot match ANY overload: PGRST202, isLegacy() reads it as an old
--  server, and the rung marks itself off and prints "run this .sql" on a loop
--  AFTER the operator has already run it. A superset of the previous migration is
--  not the same thing as a superset of the PAYLOAD, and only the payload matters.
--  That is what step 6 now checks.
--
--  THE DEFAULT ON p_fleet IS NULL, NOT '[]' — THIS IS THE WHOLE POINT
--  The original emptying happened because a client that did not send a fleet
--  still matched a signature whose default was '[]', so every heartbeat
--  overwrote a good hull list with an empty one. Here `p_fleet` defaults to NULL
--  and the update reads
--        fleet = coalesce(excluded.fleet, l.fleet)
--  i.e. a client that says nothing about its fleet LEAVES THE STORED ONE ALONE.
--  Same pattern as `defense` in territory-citadel-lv.sql, and the same pattern
--  discord-art-publish.sql already uses for hull_last / nano_last. A stale client
--  can no longer wipe a row, and the column repairs itself per-account on first
--  publish from build 726 or later.
--
--  `p_power` and `p_kills` stay numeric ON PURPOSE. Endgame fleet power passes
--  1e29, bigint tops out near 9.22e18, and JS serialises numbers that large in
--  exponential notation which no integer type parses.
--
--  create or replace CANNOT replace an overload whose argument types differ — it
--  silently adds a second copy, and PostgREST then picks the wrong candidate or
--  refuses to pick (PGRST203). So step 3 drops EVERY existing overload by
--  catalogue lookup and step 5 asserts exactly one survives.
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. the columns ---------------------------------------------------------
-- All of these have existed since their own migrations; the adds are here so the
-- file is self-sufficient on a database that is missing one.
alter table public.leaderboard
  add column if not exists fleet jsonb not null default '[]'::jsonb;
alter table public.leaderboard add column if not exists hull_last  text;
alter table public.leaderboard add column if not exists nano_last  text;
alter table public.leaderboard add column if not exists cargo_tier smallint default 0;

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

-- ---- 2. PRE-FLIGHT: PROVE THE PARAMETER TYPES MATCH THE COLUMNS -------------
-- The 42804 outage was a jsonb column taking an integer parameter, and creating a
-- function does NOT type-check its body against the table — the failure only
-- surfaced when a live client tried to publish, by which time every board was
-- down. Assert the pairings HERE, before the function exists, where a mismatch is
-- a failed migration instead of a production outage.
do $$
declare
  r record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leaderboard' and column_name = 'fleet') then
    raise exception 'leaderboard.fleet does not exist — step 1 should have created it';
  end if;
  for r in
    select column_name, data_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'leaderboard'
       and column_name in ('fleet', 'cmdr_line', 'hull_last', 'nano_last')
  loop
    if r.column_name in ('fleet', 'cmdr_line') and r.data_type <> 'jsonb' then
      raise exception 'leaderboard.% is % but its parameter is declared jsonb. Fix the declaration, do NOT widen the column.', r.column_name, r.data_type;
    end if;
    if r.column_name in ('hull_last', 'nano_last') and r.data_type <> 'text' then
      raise exception 'leaderboard.% is % but its parameter is declared text.', r.column_name, r.data_type;
    end if;
  end loop;
end $$;

-- ---- 3. drop EVERY existing overload by catalogue lookup --------------------
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

-- ---- 4. the one true lb_upsert ---------------------------------------------
-- 29 parameters, in the order the payload builders sit in js/cloud.js. Every key
-- the client can send is declared; see step 6.
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
  p_cmdr_line    jsonb  default '[]'::jsonb,
  -- THE ART FIELDS (discord-art-publish.sql). Not records and not ladders: each
  -- one names WHAT most recently happened, so the Discord feed can show that
  -- subject's real sprite. NULL default and coalesce-preserve on update — the
  -- client sends '' when there is nothing to say, and a blank must not clear a
  -- key the feed has not read yet.
  p_hull_last    text   default null,
  p_nano_last    text   default null,
  p_cargo_tier   int    default null,
  -- NULL DEFAULT. See the header: '[]' here is what emptied every row.
  p_fleet        jsonb  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A malformed payload is IGNORED, never stored: anything that is not a json
  -- array reads as "said nothing about my fleet" and the stored list survives.
  v_fleet jsonb := case when jsonb_typeof(p_fleet) = 'array' then p_fleet else null end;
begin
  if auth.uid() is null then return; end if;

  insert into public.leaderboard as l (
    user_id, name, power, level, zone, kills, asc_stars,
    tiles, citadels, tile_rev, ships, missions, badges,
    cargo, cargo_best, nano_legend, nano_slots, nano_god,
    hcwave, expo, expo_best, pilot_score, pilot_nodes, mech_cores,
    cmdr_score, cmdr_line, hull_last, nano_last, cargo_tier, fleet, updated_at
  ) values (
    auth.uid(), p_name, p_power, p_level, p_zone, p_kills, p_asc_stars,
    p_tiles, p_citadels, p_tile_rev, p_ships, p_missions, p_badges,
    p_cargo, p_cargo_best, p_nano_legend, p_nano_slots, p_nano_god,
    p_hcwave, p_expo, p_expo_best, p_pilot_score, p_pilot_nodes, p_mech_cores,
    p_cmdr_score, coalesce(p_cmdr_line, '[]'::jsonb),
    left(nullif(btrim(coalesce(p_hull_last, '')), ''), 32),
    left(nullif(btrim(coalesce(p_nano_last, '')), ''), 32),
    greatest(0, least(5, coalesce(p_cargo_tier, 0))),
    -- NOT NULL column, so a first insert with nothing to say stores the empty
    -- array. The display side reads empty as "no fleet published".
    coalesce(v_fleet, '[]'::jsonb), now()
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
    -- ART: a blank NEVER clears a stored key. A heartbeat two seconds after the
    -- one carrying the hull would otherwise blank it before the feed's next
    -- 2-minute tick — precisely the race that leaves a card art-less.
    hull_last   = coalesce(excluded.hull_last, l.hull_last),
    nano_last   = coalesce(excluded.nano_last, l.nano_last),
    cargo_tier  = case when coalesce(p_cargo_tier, 0) = 0
                       then l.cargo_tier else excluded.cargo_tier end,
    -- LIVE, BUT NEVER CLEARED BY SILENCE. A client that sends no fleet keeps the
    -- stored one; only a client that sends a real array replaces it. This single
    -- coalesce is the difference between the column working and the column being
    -- emptied on every heartbeat.
    fleet       = coalesce(v_fleet, l.fleet),
    updated_at  = now()
  where l.user_id = auth.uid();
end $$;

revoke all on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, bigint, int, int, int,
  int, int, int, int, int, int, int, int, bigint, int, bigint, bigint, jsonb,
  text, text, int, jsonb
) from public, anon;
grant execute on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, bigint, int, int, int,
  int, int, int, int, int, int, int, int, bigint, int, bigint, bigint, jsonb,
  text, text, int, jsonb
) to authenticated;

-- ---- 5. assert exactly one copy survives -----------------------------------
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

-- ---- 6. ASSERT THE SIGNATURE COVERS THE ENTIRE CLIENT PAYLOAD --------------
-- THIS IS THE CHECK THAT WAS MISSING, AND IT IS WHY THE ART FIELDS WENT
-- UNPUBLISHED FOR TWENTY-ODD BUILDS.
--
-- PostgREST matches an RPC by NAME against the parameters a function declares.
-- One key the client sends and the function does not declare means NO overload
-- matches — not "that column is ignored", but the whole call rejected with
-- PGRST202. The client reads that as an old server, walks down its rungs, and
-- prints "run this .sql" for a migration that has already run.
--
-- Every migration in this chain was checked against the PREVIOUS migration and
-- none against the payload, so a gap opened once and was inherited by every file
-- after it. The list below is the union of base/ladder/art/fresh/tree/mech/cmdr/
-- hulls in js/cloud.js lbUpsert(). WHEN A NEW RUNG ADDS A KEY, ADD IT HERE IN
-- THE SAME CHANGE.
do $$
declare
  sent text[] := array[
    'p_name','p_power','p_level','p_zone','p_kills',
    'p_asc_stars','p_cargo','p_cargo_best',
    'p_nano_legend','p_nano_slots','p_nano_god',
    'p_tiles','p_citadels','p_tile_rev','p_ships','p_missions','p_badges',
    'p_hull_last','p_nano_last','p_cargo_tier',
    'p_hcwave','p_expo','p_expo_best',
    'p_pilot_score','p_pilot_nodes',
    'p_mech_cores',
    'p_cmdr_score','p_cmdr_line',
    'p_fleet'
  ];
  declared text[];
  missing text[];
begin
  select p.proargnames into declared
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'lb_upsert';

  select array_agg(s) into missing
    from unnest(sent) as s
   where not (s = any(declared));

  if missing is not null then
    raise exception 'lb_upsert does not declare % parameter(s) the client sends: %. PostgREST will reject EVERY publish with PGRST202.',
      array_length(missing, 1), array_to_string(missing, ', ');
  end if;

  raise notice 'lb_upsert declares all % client parameters (% total declared).',
    array_length(sent, 1), array_length(declared, 1);
end $$;

notify pgrst, 'reload schema';

-- ---- 7. NOTE ON THE ROWS THAT ARE ALREADY EMPTY ----------------------------
-- Nothing is repaired retroactively and nothing should be. The hull list is
-- client-owned: each account's row fills in the first time that pilot publishes
-- from build 726 or later, which is their next heartbeat after they load the
-- game. Until then the board shows no ships for them, which is the truth.
--
-- It must NOT be back-filled from `lf-best`/`lf-backup` or from any other
-- snapshot — those predate legitimate hull sales and ascensions, and a fleet
-- strip is not worth printing a hull the pilot no longer owns.

-- ---- verify ----------------------------------------------------------------
select 'lb_upsert' as check,
       (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'lb_upsert') as copies,
       (select array_length(proargnames, 1) from pg_proc p
          join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'lb_upsert') as params;

-- How many rows carry a hull list, and how many carry art. Both should climb as
-- pilots relog onto 726.
select count(*) filter (where jsonb_array_length(fleet) > 0) as with_fleet,
       count(*) filter (where hull_last is not null)         as with_hull_art,
       count(*)                                              as rows_total
  from public.leaderboard;

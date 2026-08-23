-- =============================================================================
--  pilot-ladder.sql — THE PILOT TREE BOARD (build 712)
-- -----------------------------------------------------------------------------
--  Adds one ladder: PILOT TREE, ranked by PILOT SCORE — the sum of every
--  unlocked node's score on the hex tree (js/dreadnaught.js pilotScore()).
--
--  WHY THIS IS WORTH ITS OWN BOARD. The tree is bought with ◇ Dread Cores from a
--  WEEKLY raid, one attempt per tier per week, and it SURVIVES ascension. So it
--  is the one progression in the game that no amount of grinding shortens — a
--  deep tree is months of real calendar time and nothing else. Fleet power can
--  be rebuilt in a weekend; a Pilot Score cannot.
--
--  TWO FIGURES, because score alone does not say how it was earned: `pilot_score`
--  is the ranked value and `pilot_nodes` is the node count, which breaks ties and
--  distinguishes a wide tree from a lucky run of legendaries.
--
--  ⚠ THIS FILE SUPERSEDES new-ladders.sql AS THE CANONICAL lb_upsert.
--  It is a strict superset: every parameter new-ladders.sql declared is here,
--  in the same order, with the same types, plus the two new ones at the end.
--  Re-running cargo-ladder.sql, nanocore-ladder.sql, discord-art-publish.sql or
--  new-ladders.sql re-adds an older overload and requires re-running THIS file.
--
--  Safe to re-run. Run the whole file in one go, not in pieces — section 2 drops
--  every lb_upsert by catalogue lookup and section 5 asserts exactly one
--  survives. A half-run leaves the publish path with no function at all.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · COLUMNS
-- ---------------------------------------------------------------------------
-- bigint on the score: node scores are ~4–100 each and the tree is endless, so
-- a deep account is comfortably past what int would hold if the curve is ever
-- retuned upward. Cheap insurance against the class of bug that wraps negative.
alter table public.leaderboard add column if not exists pilot_score bigint not null default 0;
alter table public.leaderboard add column if not exists pilot_nodes int    not null default 0;

create index if not exists leaderboard_pilot_score on public.leaderboard (pilot_score desc);

-- ---------------------------------------------------------------------------
-- 2 · DROP EVERY EXISTING lb_upsert OVERLOAD, WHATEVER ITS SIGNATURE
-- ---------------------------------------------------------------------------
-- `create or replace` CANNOT replace an overload whose argument types differ —
-- it silently adds a second copy, and PostgREST then either picks the wrong
-- candidate or refuses to pick (PGRST203). Catalogue lookup, every time.
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'lb_upsert'
  loop
    execute 'drop function ' || r.sig;
    n := n + 1;
  end loop;
  raise notice 'pilot-ladder: dropped % lb_upsert overload(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · THE ONE CANONICAL lb_upsert — now with pilot_score + pilot_nodes
-- ---------------------------------------------------------------------------
-- p_power and p_kills are `numeric` ON PURPOSE and must stay that way: endgame
-- fleet power passes 1e29 (bigint tops out near 9.22e18) and JS serialises
-- numbers that large in exponential notation, which no integer type parses.
create or replace function public.lb_upsert(
  p_name        text,
  p_power       numeric default 0,
  p_level       int     default 0,
  p_zone        int     default 0,
  p_kills       numeric default 0,
  p_asc         int     default null,
  p_tiles       int     default null,
  p_citadels    int     default null,
  p_tile_rev    numeric default null,
  p_ships       int     default null,
  p_missions    int     default null,
  p_badges      int     default null,
  p_cargo       int     default null,
  p_cargo_best  int     default null,
  p_nano_legend int     default null,
  p_nano_slots  int     default null,
  p_nano_god    int     default null,
  p_hull_last   text    default null,
  p_nano_last   text    default null,
  p_cargo_tier  int     default null,
  p_hcwave      int     default null,
  p_expo        int     default null,
  p_expo_best   int     default null,
  p_pilot_score bigint  default null,
  p_pilot_nodes int     default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.leaderboard as l (
    user_id, name, power, level, zone, kills,
    asc_stars, tiles, citadels, tile_rev, ships, missions, badges,
    cargo, cargo_best, nano_legend, nano_slots, nano_god,
    hull_last, nano_last, cargo_tier,
    hcwave, expo, expo_best,
    pilot_score, pilot_nodes,
    updated_at
  )
  values (
    auth.uid(),
    left(btrim(coalesce(p_name, 'Operator')), 24),
    greatest(0, coalesce(p_power, 0)),
    greatest(0, coalesce(p_level, 0)),
    greatest(0, coalesce(p_zone, 0)),
    greatest(0, coalesce(p_kills, 0)),
    greatest(0, coalesce(p_asc, 0)),
    greatest(0, coalesce(p_tiles, 0)),
    greatest(0, coalesce(p_citadels, 0)),
    greatest(0, coalesce(p_tile_rev, 0)),
    greatest(0, coalesce(p_ships, 0)),
    greatest(0, coalesce(p_missions, 0)),
    greatest(0, coalesce(p_badges, 0)),
    greatest(0, coalesce(p_cargo, 0)),
    greatest(0, least(100, coalesce(p_cargo_best, 0))),
    greatest(0, coalesce(p_nano_legend, 0)),
    greatest(0, least(5, coalesce(p_nano_slots, 0))),
    greatest(0, coalesce(p_nano_god, 0)),
    left(nullif(btrim(coalesce(p_hull_last, '')), ''), 32),
    left(nullif(btrim(coalesce(p_nano_last, '')), ''), 32),
    greatest(0, least(5, coalesce(p_cargo_tier, 0))),
    greatest(0, least(100000, coalesce(p_hcwave, 0))),
    greatest(0, coalesce(p_expo, 0)),
    greatest(0, coalesce(p_expo_best, 0)),
    -- PILOT TREE. Bounded generously rather than left open: the tree is endless
    -- by design, but a figure past this is not a deep tree, it is a bad client.
    greatest(0, least(1000000000, coalesce(p_pilot_score, 0))),
    greatest(0, least(1000000,    coalesce(p_pilot_nodes, 0))),
    now()
  )
  on conflict (user_id) do update set
    name      = excluded.name,
    power     = greatest(l.power,  excluded.power),
    level     = greatest(l.level,  excluded.level),
    zone      = greatest(l.zone,   excluded.zone),
    kills     = greatest(l.kills,  excluded.kills),
    asc_stars = case when p_asc      is null then l.asc_stars else greatest(l.asc_stars, excluded.asc_stars) end,
    tiles     = case when p_tiles    is null then l.tiles     else excluded.tiles     end,
    citadels  = case when p_citadels is null then l.citadels  else excluded.citadels  end,
    tile_rev  = case when p_tile_rev is null then l.tile_rev  else excluded.tile_rev  end,
    ships     = case when p_ships    is null then l.ships     else greatest(l.ships,    excluded.ships)    end,
    missions  = case when p_missions is null then l.missions  else greatest(l.missions, excluded.missions) end,
    badges    = case when p_badges   is null then l.badges    else greatest(l.badges,   excluded.badges)   end,
    cargo     = case when p_cargo      is null then l.cargo      else greatest(l.cargo,      excluded.cargo)      end,
    cargo_best= case when p_cargo_best is null then l.cargo_best else greatest(l.cargo_best, excluded.cargo_best) end,
    nano_legend = case when p_nano_legend is null then l.nano_legend else greatest(l.nano_legend, excluded.nano_legend) end,
    nano_slots  = case when p_nano_slots  is null then l.nano_slots  else greatest(l.nano_slots,  excluded.nano_slots)  end,
    nano_god    = case when p_nano_god    is null then l.nano_god    else greatest(l.nano_god,    excluded.nano_god)    end,
    hull_last  = coalesce(excluded.hull_last,  l.hull_last),
    nano_last  = coalesce(excluded.nano_last,  l.nano_last),
    cargo_tier = case when coalesce(p_cargo_tier, 0) = 0
                      then l.cargo_tier else excluded.cargo_tier end,
    hcwave    = case when p_hcwave    is null then l.hcwave    else greatest(l.hcwave,    excluded.hcwave)    end,
    expo      = case when p_expo      is null then l.expo      else greatest(l.expo,      excluded.expo)      end,
    expo_best = case when p_expo_best is null then l.expo_best else greatest(l.expo_best, excluded.expo_best) end,
    -- THE TREE ONLY EVER GROWS. Nodes cannot be refunded and the whole tree
    -- rides through ascension in ASC_KEEP, so greatest() matches the save. It
    -- also means a stale client that publishes an older figure cannot walk a
    -- pilot's board position backwards.
    pilot_score = case when p_pilot_score is null then l.pilot_score else greatest(l.pilot_score, excluded.pilot_score) end,
    pilot_nodes = case when p_pilot_nodes is null then l.pilot_nodes else greatest(l.pilot_nodes, excluded.pilot_nodes) end,
    updated_at = now();
end $$;

grant execute on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, numeric, int, int, int,
  int, int, int, int, int, text, text, int, int, int, int, bigint, int
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · VERIFY EXACTLY ONE lb_upsert SURVIVES
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'lb_upsert';
  if n <> 1 then
    raise exception 'pilot-ladder: expected exactly 1 lb_upsert, found %', n;
  end if;
  raise notice 'pilot-ladder: lb_upsert OK (1 definition)';
end $$;

select p.oid::regprocedure as lb_upsert_signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'lb_upsert';

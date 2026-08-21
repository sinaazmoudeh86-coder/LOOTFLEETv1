-- =============================================================================
--  new-ladders.sql — LOOTFLEET · HOME DEFENSE + EXPLORATION + KING OF THE HILL
--  Build 688. Run AFTER discord-art-publish.sql and koth.sql.
-- =============================================================================
--
--  THREE LADDERS, TWO DIFFERENT MECHANISMS — on purpose.
--
--   1. HOME DEFENSE (deepest wave held) and EXPLORATION (expeditions completed)
--      are ordinary save-derived figures like Hangar or Missions, so they ride
--      the existing leaderboard row and publish through lb_upsert.
--
--   2. KING OF THE HILL already has its own authoritative tables. Its DAILY
--      board is koth_top() — live, server-owned, unchanged by this file. Its
--      LIFETIME board is a count of koth_hall crowns, added here as
--      koth_hall_top(). Neither goes through lb_upsert: a crown is awarded by
--      koth_close() and must never be something a client can publish about
--      itself.
--
--  WHY lb_upsert IS DROPPED AND REBUILT RATHER THAN "REPLACED"
--  ---------------------------------------------------------------------------
--  Adding p_hcwave and p_expo CHANGES THE ARGUMENT LIST. `create or replace`
--  cannot replace an overload whose argument types differ — it silently adds a
--  SECOND copy, which is exactly how three lb_upsert overloads went live at
--  build 591. Step 2 drops every existing overload by catalogue lookup and
--  step 5 asserts exactly one survives.
--
--  p_power AND p_kills ARE numeric, NOT bigint. Endgame fleet power passes 1e29
--  (bigint tops out near 9.22e18) and JS serialises numbers that large in
--  exponential notation, which no integer type parses.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · COLUMNS (idempotent)
-- ---------------------------------------------------------------------------
alter table public.leaderboard add column if not exists hcwave int not null default 0;
alter table public.leaderboard add column if not exists expo    int not null default 0;
alter table public.leaderboard add column if not exists expo_best int not null default 0;

alter table public.sim_pilots add column if not exists hcwave int not null default 0;
alter table public.sim_pilots add column if not exists expo    int not null default 0;
alter table public.sim_pilots add column if not exists expo_best int not null default 0;

-- Give the simulated pilots plausible figures so the new boards are not empty
-- on day one. Derived from each sim's existing depth so a sim that is strong on
-- Power is strong here too — a sim that contradicts itself reads as a bug.
do $$
begin
  update public.sim_pilots
     set hcwave = greatest(hcwave, greatest(1, least(400, (level / 3)::int + (zone / 6)::int))),
         expo   = greatest(expo,   greatest(0, (level / 5)::int + (zone / 9)::int)),
         expo_best = greatest(expo_best, greatest(20, least(420, (level * 2)::int)))
   where level is not null;
exception when others then
  raise notice 'new-ladders: sim_pilots backfill skipped (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · DROP EVERY EXISTING lb_upsert OVERLOAD, WHATEVER ITS SIGNATURE
-- ---------------------------------------------------------------------------
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
  raise notice 'new-ladders: dropped % lb_upsert overload(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · THE ONE CANONICAL lb_upsert — now with hcwave + expo
-- ---------------------------------------------------------------------------
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
  p_expo_best   int     default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.leaderboard as l (
    user_id, name, power, level, zone, kills,
    asc_stars, tiles, citadels, tile_rev, ships, missions, badges,
    cargo, cargo_best, nano_legend, nano_slots, nano_god,
    hull_last, nano_last, cargo_tier,
    hcwave, expo, expo_best,
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
    -- HOME DEFENSE. Capped well above anything reachable rather than left open:
    -- a wave figure is small and bounded, and a nonsense one would sit at the
    -- top of the board forever.
    greatest(0, least(100000, coalesce(p_hcwave, 0))),
    greatest(0, coalesce(p_expo, 0)),
    greatest(0, coalesce(p_expo_best, 0)),
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
    -- CAREER RECORDS: both only ever climb. A wave lost to a breach is still the
    -- deepest wave that pilot has held, and ascension does not clear the Home
    -- Citadel — so greatest() here matches what the save itself does.
    hcwave    = case when p_hcwave    is null then l.hcwave    else greatest(l.hcwave,    excluded.hcwave)    end,
    expo      = case when p_expo      is null then l.expo      else greatest(l.expo,      excluded.expo)      end,
    expo_best = case when p_expo_best is null then l.expo_best else greatest(l.expo_best, excluded.expo_best) end,
    updated_at = now();
end $$;

grant execute on function public.lb_upsert(
  text, numeric, int, int, numeric, int, int, int, numeric, int, int, int,
  int, int, int, int, int, text, text, int, int, int, int
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · KING OF THE HILL — LIFETIME CROWNS
-- ---------------------------------------------------------------------------
-- Ranked from koth_hall, which only koth_close() writes. A crown cannot be
-- self-reported, so this board needs no client publish path and no anti-cheat
-- of its own — the eligibility test already ran at close.
--
-- Ties break on total kills across all winning days: two pilots with three
-- crowns each are separated by how hard they had to fight for them.
drop function if exists public.koth_hall_top(int);
create or replace function public.koth_hall_top(p_n int default 25)
returns table (rank int, user_id uuid, name text, wins int, kills numeric, last_day int)
language sql stable security definer set search_path = public as $$
  with agg as (
    select h.user_id,
           max(h.name)               as name,
           count(*)::int             as wins,
           sum(h.kills)::numeric     as kills,
           max(h.day)::int           as last_day
      from public.koth_hall h
     where h.user_id is not null
     group by h.user_id
  )
  select (row_number() over (order by wins desc, kills desc, last_day asc))::int,
         user_id, name, wins, kills, last_day
    from agg
   order by wins desc, kills desc, last_day asc
   limit greatest(1, least(coalesce(p_n, 25), 100))
$$;
grant execute on function public.koth_hall_top(int) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5 · VERIFY EXACTLY ONE lb_upsert SURVIVES
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'lb_upsert';
  if n <> 1 then
    raise exception 'new-ladders: expected exactly 1 lb_upsert, found %', n;
  end if;
  raise notice 'new-ladders: lb_upsert OK (1 definition)';
end $$;

-- ---------------------------------------------------------------------------
-- 6 · NOTE FOR FUTURE MIGRATIONS
-- ---------------------------------------------------------------------------
-- THIS FILE IS NOW THE CANONICAL lb_upsert, superseding discord-art-publish.sql.
-- Re-running cargo-ladder.sql, nanocore-ladder.sql or discord-art-publish.sql
-- re-adds an older overload and requires re-running this file.

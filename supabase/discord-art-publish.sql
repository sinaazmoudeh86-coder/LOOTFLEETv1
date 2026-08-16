-- =============================================================================
--  discord-art-publish.sql — LOOTFLEET · ONE canonical lb_upsert, with the art
--                             fields the Discord feed needs
--  ---------------------------------------------------------------------------
--  WHAT THIS FIXES — TWO FAULTS, ONE FUNCTION.
--
--  1 · THE ART FIELDS NEVER REACHED THE TABLE. A NEW HULL card posted with no
--      sprite. Everything upstream was right: the columns existed, the client
--      computed hull_last / nano_last / cargo_tier, the feed selected them by
--      name. They were dropped at the last boundary — lb_upsert enumerates its
--      params and had none of the three, so PostgREST discarded them.
--
--  2 · THREE OVERLOADS OF lb_upsert ARE LIVE, AND TWO USE bigint.
--      A catalogue check returns three rows today:
--        lb_upsert(text, numeric, int, int, numeric, jsonb, ...)   ← widened
--        lb_upsert(text, bigint,  int, int, bigint,  jsonb, ...)   ← re-narrowed
--        lb_upsert(text, bigint,  int, int, bigint,  jsonb, ...)   ← re-narrowed
--
--      bignum-power-fix.sql widened power/kills to numeric because real endgame
--      fleet power reaches ~2.3e29 — about 25 billion times the bigint ceiling —
--      and because JS serialises numbers that large in exponential notation,
--      which no integer type will parse. It deliberately rewrote whatever
--      overload was live rather than hand-writing a signature, and its own step 4
--      warns that more than one row per name means "the ambiguity fault is back".
--
--      cargo-ladder.sql and nanocore-ladder.sql then ran, each declaring
--      `p_power bigint, p_kills bigint` afresh. `create or replace` cannot
--      replace a function whose argument TYPES differ, so each one added a new
--      overload beside the widened copy instead of updating it. The ceiling is
--      back on the newest rung — the one the client tries FIRST — and cloud.js
--      treats a 22P02 as a hard failure rather than a reason to degrade, so a
--      high-power pilot's publish is abandoned for that tick instead of falling
--      through. Ambiguity (PGRST203) is not in isLegacy() either.
--
--  SO THIS FILE DROPS EVERY OVERLOAD AND INSTALLS EXACTLY ONE — numeric where
--  numeric belongs, with the three art params on the end.
--
--  Supersedes discord-art-fields.sql (run this one; skip that file).
--  SAFE TO RE-RUN. Verify at the bottom must return exactly ONE row.
--
--  ⚠ IF YOU EVER RE-RUN cargo-ladder.sql OR nanocore-ladder.sql, they will add a
--    bigint overload back and you must run this file again afterwards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · columns (idempotent — no-ops if discord-art-fields.sql already ran)
-- ---------------------------------------------------------------------------
alter table public.leaderboard add column if not exists hull_last  text;
alter table public.leaderboard add column if not exists nano_last  text;
alter table public.leaderboard add column if not exists cargo_tier smallint default 0;

alter table public.sim_pilots add column if not exists hull_last  text;
alter table public.sim_pilots add column if not exists nano_last  text;
alter table public.sim_pilots add column if not exists cargo_tier smallint default 0;

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

-- Power and kills must be numeric on the TABLE too, or a widened parameter just
-- overflows one step later. No-ops if bignum-power-fix.sql already ran.
alter table public.leaderboard
  alter column power type numeric using power::numeric,
  alter column kills type numeric using kills::numeric;

-- ---------------------------------------------------------------------------
-- 2 · drop EVERY lb_upsert overload, whatever its shape
-- ---------------------------------------------------------------------------
-- By catalogue lookup, not by hand-written signature — the same technique
-- bignum-power-fix.sql used, and for the same reason: guessing a signature is
-- how a second copy gets added instead of the live one being replaced.
--
-- NO CASCADE. If anything in the schema depends on lb_upsert this must fail
-- loudly so you can look at it, not silently delete the dependent object.
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.proname = 'lb_upsert'
  loop
    execute 'drop function if exists ' || r.sig::text;
    raise notice 'DROPPED %', r.sig;
    n := n + 1;
  end loop;
  raise notice 'removed % lb_upsert overload(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · the one canonical function
-- ---------------------------------------------------------------------------
create or replace function public.lb_upsert(
  p_name        text,
  -- NUMERIC, NOT bigint. Endgame fleet power passes 1e29 and arrives in
  -- exponential notation; numeric is arbitrary-precision and accepts it.
  p_power       numeric default 0,
  p_level       int     default 1,
  p_zone        int     default 1,
  p_kills       numeric default 0,
  p_fleet       jsonb   default '[]'::jsonb,
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
  -- THE ART FIELDS. Not records and not ladders: each one names WHAT most
  -- recently happened, so the feed can show that subject's real sprite.
  p_hull_last   text    default null,
  p_nano_last   text    default null,
  p_cargo_tier  int     default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;

  insert into public.leaderboard as l
    (user_id, name, power, level, zone, kills, fleet,
     asc_stars, tiles, citadels, tile_rev, ships, missions, badges, cargo, cargo_best,
     nano_legend, nano_slots, nano_god,
     hull_last, nano_last, cargo_tier, updated_at)
  values (
    auth.uid(),
    left(coalesce(nullif(btrim(p_name), ''), 'Operator'), 24),
    greatest(0, coalesce(p_power, 0)),
    greatest(1, coalesce(p_level, 1)),
    greatest(1, coalesce(p_zone, 1)),
    greatest(0, coalesce(p_kills, 0)),
    coalesce(p_fleet, '[]'::jsonb),
    greatest(0, least(500, coalesce(p_asc, 0))),
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
    now()
  )
  on conflict (user_id) do update set
    name      = excluded.name,
    power     = excluded.power,
    level     = excluded.level,
    zone      = excluded.zone,
    kills     = excluded.kills,
    fleet     = excluded.fleet,
    -- monotonic records never regress on a stale or older-client write
    asc_stars = case when p_asc        is null then l.asc_stars  else greatest(l.asc_stars, excluded.asc_stars) end,
    tiles     = case when p_tiles      is null then l.tiles      else excluded.tiles    end,
    citadels  = case when p_citadels   is null then l.citadels   else excluded.citadels end,
    tile_rev  = case when p_tile_rev   is null then l.tile_rev   else excluded.tile_rev end,
    ships     = case when p_ships      is null then l.ships      else excluded.ships    end,
    missions  = case when p_missions   is null then l.missions   else greatest(l.missions,   excluded.missions)   end,
    badges    = case when p_badges     is null then l.badges     else greatest(l.badges,     excluded.badges)     end,
    cargo     = case when p_cargo      is null then l.cargo      else greatest(l.cargo,      excluded.cargo)      end,
    cargo_best= case when p_cargo_best is null then l.cargo_best else greatest(l.cargo_best, excluded.cargo_best) end,
    -- nanocore figures are career records: they only ever climb
    nano_legend = case when p_nano_legend is null then l.nano_legend else greatest(l.nano_legend, excluded.nano_legend) end,
    nano_slots  = case when p_nano_slots  is null then l.nano_slots  else greatest(l.nano_slots,  excluded.nano_slots)  end,
    nano_god    = case when p_nano_god    is null then l.nano_god    else greatest(l.nano_god,    excluded.nano_god)    end,
    -- THE ART FIELDS ARE "MOST RECENT", NOT "BEST" — they overwrite. But an
    -- EMPTY value never clears a good one: a client publishes every 90 seconds
    -- and only one of those follows a hull purchase, so overwriting with ''
    -- would blank the key before the feed's next 2-minute tick — precisely the
    -- race that leaves a card art-less.
    hull_last  = coalesce(excluded.hull_last,  l.hull_last),
    nano_last  = coalesce(excluded.nano_last,  l.nano_last),
    cargo_tier = case when coalesce(p_cargo_tier, 0) = 0
                      then l.cargo_tier else excluded.cargo_tier end,
    updated_at = now();
end $$;

grant execute on function public.lb_upsert(
  text, numeric, int, int, numeric, jsonb, int, int, int, numeric,
  int, int, int, int, int, int, int, int, text, text, int
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · verify — this is the important part
-- ---------------------------------------------------------------------------
-- EXACTLY ONE ROW, 21 args, ending in text, text, integer. More than one row
-- means PostgREST can pick the wrong candidate (or refuse to pick at all) and
-- publishing breaks for someone.
select p.oid::regprocedure as signature, p.pronargs as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'lb_upsert';

do $$
declare c int;
begin
  select count(*) into c
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lb_upsert';
  if c = 1 then raise notice 'OK — exactly one lb_upsert.';
  else raise warning 'STILL % COPIES of lb_upsert — resolve before relying on the ladder', c;
  end if;
end $$;

-- power and kills must both read `numeric`.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'leaderboard'
   and column_name in ('power', 'kills', 'hull_last', 'nano_last', 'cargo_tier')
 order by column_name;

-- After a client on build 591+ has published once, anyone who bought a hull
-- since should show a ship key here (not null, not empty).
select name, ships, hull_last, nano_last, cargo_tier, updated_at
  from public.leaderboard
 order by updated_at desc
 limit 10;

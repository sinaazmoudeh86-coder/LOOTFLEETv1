-- =============================================================================
--  ⛔ SUPERSEDED — DO NOT RUN THIS FILE. `new-ladders.sql` is the canonical
--  `lb_upsert`. Two reasons this one is now a trap:
--    1. It re-declares an OLDER overload of lb_upsert (fewer params), and
--       `create or replace` cannot replace an overload whose argument list
--       differs — it silently ADDS a second copy. Two live copies mean PostgREST
--       picks the wrong candidate or refuses to pick at all.
--    2. Its insert clamps `p_badges` at 1,000 (see the `least(1000, …)` below).
--       The ladder is 1,110 badges as of build 670, so that clamp truncates a
--       real count AND disagrees with every screen that prints it.
--  Kept only as the historical record of when these columns were added.
-- =============================================================================
--  ranks-ladders.sql — five new columns + the patrons ladder
--  ---------------------------------------------------------------------------
--  The Ranks screen grows from one board (fleet power) to six. Four of the new
--  ladders read columns that ride along on the leaderboard row every account
--  already publishes on its heartbeat.
--
--  Voidmaw needs nothing new — sdread_scores already carries stage and total.
--
--  Safe to re-run. Run BEFORE deploying the build that publishes these fields;
--  the new lb_upsert parameters are all optional and default to null, so a
--  client from the previous build still binds to this same function and simply
--  leaves the new columns alone.
-- =============================================================================

-- ---- 1. COLUMNS -------------------------------------------------------------
alter table public.leaderboard add column if not exists tiles    int     not null default 0;
alter table public.leaderboard add column if not exists citadels int     not null default 0;
alter table public.leaderboard add column if not exists tile_rev numeric not null default 0;
alter table public.leaderboard add column if not exists ships    int     not null default 0;
alter table public.leaderboard add column if not exists missions int     not null default 0;
alter table public.leaderboard add column if not exists badges   int     not null default 0;

-- Territory count is authoritative in `territory`, so seed from there rather
-- than waiting for every account to log in once.
update public.leaderboard l set
  tiles    = coalesce(t.n, 0),
  citadels = coalesce(t.c, 0)
from (
  select owner_id, count(*) as n, count(*) filter (where citadel) as c
    from public.territory where owner_id is not null group by owner_id
) t
where t.owner_id = l.user_id and l.tiles = 0;

-- ---- 2. lb_upsert — five optional trailing parameters -----------------------
-- NULL means "don't touch": a client that predates this migration keeps its
-- existing values instead of zeroing a veteran's badge count on every heartbeat.
do $$ declare r record; begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'lb_upsert' and pronamespace = 'public'::regnamespace loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

create or replace function public.lb_upsert(
  p_name text,
  p_power bigint,
  p_level int,
  p_zone int,
  p_kills bigint,
  p_fleet jsonb default '[]'::jsonb,
  p_asc int default null,
  p_tiles int default null,
  p_citadels int default null,
  p_tile_rev numeric default null,
  p_ships int default null,
  p_missions int default null,
  p_badges int default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.leaderboard as l
    (user_id, name, power, level, zone, kills, fleet, asc_stars,
     tiles, citadels, tile_rev, ships, missions, badges, updated_at)
  values (
    auth.uid(),
    left(coalesce(nullif(p_name, ''), 'Operator'), 24),
    greatest(0, coalesce(p_power, 0)),
    greatest(1, coalesce(p_level, 1)),
    greatest(1, coalesce(p_zone, 1)),
    greatest(0, coalesce(p_kills, 0)),
    coalesce(p_fleet, '[]'::jsonb),
    greatest(0, coalesce(p_asc, 0)),
    greatest(0, coalesce(p_tiles, 0)),
    greatest(0, coalesce(p_citadels, 0)),
    greatest(0, coalesce(p_tile_rev, 0)),
    greatest(0, coalesce(p_ships, 0)),
    greatest(0, coalesce(p_missions, 0)),
    least(1000, greatest(0, coalesce(p_badges, 0))),
    now()
  )
  on conflict (user_id) do update set
    name       = excluded.name,
    power      = excluded.power,
    level      = excluded.level,
    zone       = excluded.zone,
    kills      = excluded.kills,
    fleet      = excluded.fleet,
    asc_stars  = case when p_asc      is null then l.asc_stars else excluded.asc_stars end,
    tiles      = case when p_tiles    is null then l.tiles     else excluded.tiles     end,
    citadels   = case when p_citadels is null then l.citadels  else excluded.citadels  end,
    tile_rev   = case when p_tile_rev is null then l.tile_rev  else excluded.tile_rev  end,
    ships      = case when p_ships    is null then l.ships     else excluded.ships     end,
    -- CAREER COUNTERS ONLY EVER CLIMB. A fresh install that hasn't loaded its
    -- cloud save yet would otherwise publish 0 and erase a veteran's record.
    missions   = case when p_missions is null then l.missions else greatest(l.missions, excluded.missions) end,
    badges     = case when p_badges   is null then l.badges   else greatest(l.badges,   excluded.badges)   end,
    updated_at = now();
end $$;

grant execute on function public.lb_upsert(text, bigint, int, int, bigint, jsonb, int, int, int, numeric, int, int, int) to authenticated;

-- Patrons (LootCoins purchased) was cut: it would have read `purchases`, which
-- is empty and stays empty while the Stripe webhook is undeployed.
drop function if exists public.lb_patrons(int);

-- ---- CHECK ------------------------------------------------------------------
-- select name, power, tiles, citadels, tile_rev, ships, missions, badges
--   from leaderboard order by power desc limit 20;

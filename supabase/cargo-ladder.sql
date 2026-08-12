-- =============================================================================
--  cargo-ladder.sql — HAULAGE ladder columns (run once in the SQL Editor)
--  Adds lifetime Cargo Defense deliveries + best delivered condition to the
--  leaderboard row, and re-creates lb_upsert with two new OPTIONAL params.
--  Run AFTER lb-onefunction.sql. Until this runs, clients publish without the
--  cargo params (their own degrade flag) and the HAULAGE board shows its
--  "server not migrated" notice — nothing else is affected.
-- =============================================================================

alter table public.leaderboard add column if not exists cargo      int      not null default 0;
alter table public.leaderboard add column if not exists cargo_best smallint not null default 0;

create or replace function public.lb_upsert(
  p_name       text,
  p_power      bigint  default 0,
  p_level      int     default 1,
  p_zone       int     default 1,
  p_kills      bigint  default 0,
  p_fleet      jsonb   default '[]'::jsonb,
  p_asc        int     default null,
  p_tiles      int     default null,
  p_citadels   int     default null,
  p_tile_rev   numeric default null,
  p_ships      int     default null,
  p_missions   int     default null,
  p_badges     int     default null,
  p_cargo      int     default null,
  p_cargo_best int     default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;

  insert into public.leaderboard as l
    (user_id, name, power, level, zone, kills, fleet,
     asc_stars, tiles, citadels, tile_rev, ships, missions, badges, cargo, cargo_best, updated_at)
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
    updated_at = now();
end $$;

grant execute on function public.lb_upsert(
  text, bigint, int, int, bigint, jsonb, int, int, int, numeric, int, int, int, int, int
) to authenticated;

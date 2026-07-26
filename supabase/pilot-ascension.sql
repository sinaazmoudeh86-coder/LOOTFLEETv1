-- =============================================================================
-- pilot-ascension.sql — publish Pilot Ascension stars on the public leaderboard
-- so every board, profile and galaxy tooltip can show a pilot's rank badge.
--
-- Safe to re-run. The client sends p_asc optimistically and silently falls back
-- to the old signature until this has been applied, so there is no flag day.
--
-- NOTE ON NAMING: the column is `asc_stars`, NOT `asc`. `ASC` is a reserved key
-- word in PostgreSQL, so an unquoted `asc` column is a syntax error. `asc_stars`
-- also matches the sim roster's column name.
-- =============================================================================

alter table leaderboard add column if not exists asc_stars smallint not null default 0;

-- lb_upsert gains p_asc. The old 6-arg signature is left in place so clients
-- mid-rollout keep working; it simply doesn't touch the asc_stars column.
create or replace function lb_upsert(
  p_name text, p_power bigint, p_level int, p_zone int, p_kills bigint,
  p_fleet jsonb, p_asc int default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into leaderboard as l (user_id, name, power, level, zone, kills, fleet, asc_stars, updated_at)
  values (auth.uid(), left(coalesce(p_name,'Operator'),24), greatest(0,coalesce(p_power,0)),
          greatest(1,coalesce(p_level,1)), greatest(1,coalesce(p_zone,1)),
          greatest(0,coalesce(p_kills,0)), coalesce(p_fleet,'[]'::jsonb),
          greatest(0, least(500, coalesce(p_asc,0))), now())
  on conflict (user_id) do update set
    name = excluded.name, power = excluded.power, level = excluded.level,
    zone = excluded.zone, kills = excluded.kills, fleet = excluded.fleet,
    -- ascension stars never regress on a stale write
    asc_stars = greatest(l.asc_stars, excluded.asc_stars),
    updated_at = now();
end $$;

grant execute on function lb_upsert(text, bigint, int, int, bigint, jsonb, int) to authenticated;

-- territory claims already carry a free-form `defense` jsonb; the client now
-- includes { asc: <stars> } inside it, so no schema change is needed there.

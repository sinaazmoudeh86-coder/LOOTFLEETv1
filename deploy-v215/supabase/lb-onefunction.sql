-- =============================================================================
--  lb-onefunction.sql — ONE lb_upsert, every arity, no ambiguity    (run once)
--  ---------------------------------------------------------------------------
--  MEASURED against the live database, Aug 2026:
--
--    6-arg  lb_upsert(name,power,level,zone,kills,fleet)
--           → "Could not choose the best candidate function between:
--              lb_upsert(... p_power => numeric, p_kills => numeric ...),
--              lb_upsert(... p_power => bigint,  p_kills => bigint, p_asc => int)"
--    7-arg  (+ p_asc)                        → accepted
--    13-arg (+ the six ladder columns)       → "Could not find the function"
--
--  Two live faults, one cause: lb_upsert exists MORE THAN ONCE. A numeric-typed
--  overload survived lb-upsert-canonical.sql, so the 6-arg path every stale
--  cached client still uses matches two candidates and PostgREST refuses to
--  pick — that client can never publish again, no matter how much it plays.
--  Meanwhile ranks-ladders.sql was never applied, so the six Ranks boards have
--  been ranking on columns nothing writes.
--
--  Applying ranks-ladders.sql ALONE would have made this worse: its signature
--  defaults p_asc, so a 7-arg call would then have matched it AND the canonical
--  function, breaking the one path that still worked.
--
--  THE FIX: drop every lb_upsert that exists — by catalogue lookup, not by
--  guessing signatures — and create exactly one whose every parameter after
--  p_name has a default. 6-, 7- and 13-argument calls then all bind to it, and
--  no future migration can add a competing overload without replacing this one.
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. LADDER COLUMNS ------------------------------------------------------
alter table public.leaderboard add column if not exists asc_stars smallint not null default 0;
alter table public.leaderboard add column if not exists tiles     int     not null default 0;
alter table public.leaderboard add column if not exists citadels  int     not null default 0;
alter table public.leaderboard add column if not exists tile_rev  numeric not null default 0;
alter table public.leaderboard add column if not exists ships     int     not null default 0;
alter table public.leaderboard add column if not exists missions  int     not null default 0;
alter table public.leaderboard add column if not exists badges    int     not null default 0;

-- ---- 2. DROP EVERY EXISTING OVERLOAD ---------------------------------------
-- By catalogue, so an overload nobody remembers creating still goes.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig
    from pg_proc
    where proname = 'lb_upsert' and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

-- ---- 3. THE ONE FUNCTION ----------------------------------------------------
-- Every parameter after p_name defaults, so all three call shapes bind here.
-- NULL means "leave this column alone": a client that predates a column must
-- never zero a veteran's career counters just by publishing power and level.
create or replace function public.lb_upsert(
  p_name     text,
  p_power    bigint  default 0,
  p_level    int     default 1,
  p_zone     int     default 1,
  p_kills    bigint  default 0,
  p_fleet    jsonb   default '[]'::jsonb,
  p_asc      int     default null,
  p_tiles    int     default null,
  p_citadels int     default null,
  p_tile_rev numeric default null,
  p_ships    int     default null,
  p_missions int     default null,
  p_badges   int     default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;

  insert into public.leaderboard as l
    (user_id, name, power, level, zone, kills, fleet,
     asc_stars, tiles, citadels, tile_rev, ships, missions, badges, updated_at)
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
    now()
  )
  on conflict (user_id) do update set
    name      = excluded.name,
    power     = excluded.power,
    level     = excluded.level,
    zone      = excluded.zone,
    kills     = excluded.kills,
    fleet     = excluded.fleet,
    -- these never regress on a stale or older-client write
    asc_stars = case when p_asc      is null then l.asc_stars else greatest(l.asc_stars, excluded.asc_stars) end,
    tiles     = case when p_tiles    is null then l.tiles     else excluded.tiles    end,
    citadels  = case when p_citadels is null then l.citadels  else excluded.citadels end,
    tile_rev  = case when p_tile_rev is null then l.tile_rev  else excluded.tile_rev end,
    ships     = case when p_ships    is null then l.ships     else excluded.ships    end,
    missions  = case when p_missions is null then l.missions  else greatest(l.missions, excluded.missions) end,
    badges    = case when p_badges   is null then l.badges    else greatest(l.badges,   excluded.badges)   end,
    updated_at = now();
end $$;

grant execute on function public.lb_upsert(
  text, bigint, int, int, bigint, jsonb, int, int, int, numeric, int, int, int
) to authenticated;

-- ---- 4. READ PATH -----------------------------------------------------------
alter table public.leaderboard enable row level security;
drop policy if exists "leaderboard_read" on public.leaderboard;
create policy "leaderboard_read" on public.leaderboard for select using (true);
grant select on public.leaderboard to anon, authenticated;

-- ---- 5. SEED ANYONE STILL MISSING ------------------------------------------
-- Idempotent, insert-only. Repeats lb-seed-missing.sql's backfill because a
-- player who has been unable to publish since the ambiguity appeared may have
-- been created after that file was last run.
create or replace function public.lf_clamp_power(v numeric)
returns bigint language sql immutable as $$
  select least(greatest(coalesce(v, 0), 0), 9223372036854775807::numeric)::bigint;
$$;

with active as (
  select owner_id as user_id, max(owner_name) as name
    from public.territory where owner_id is not null group by owner_id
  union
  select user_id, max(name)
    from public.sdread_scores where user_id is not null group by user_id
),
best as (
  select distinct on (t.owner_id) t.owner_id as user_id, t.fleet_score, t.owner_name
    from public.territory t
   where t.owner_id is not null
   order by t.owner_id, t.citadel asc nulls first, t.updated_at desc
)
insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, updated_at)
select a.user_id,
       left(coalesce(b.owner_name, a.name, 'Operator'), 24),
       public.lf_clamp_power(b.fleet_score),
       1, 1, 0, '[]'::jsonb, now()
  from active a
  left join best b on b.user_id = a.user_id
 where a.user_id is not null
on conflict (user_id) do nothing;

-- ---- VERIFY -----------------------------------------------------------------
-- Exactly ONE row — if this returns two, an old overload came back:
--   select oid::regprocedure from pg_proc
--    where proname = 'lb_upsert' and pronamespace = 'public'::regnamespace;
--
-- Board size before/after:
--   select count(*) from public.leaderboard;
--
-- Anyone active but still unlisted (expect zero rows):
--   select a.user_id from (
--     select owner_id as user_id from public.territory where owner_id is not null
--     union select user_id from public.sdread_scores where user_id is not null
--   ) a left join public.leaderboard l using (user_id) where l.user_id is null;

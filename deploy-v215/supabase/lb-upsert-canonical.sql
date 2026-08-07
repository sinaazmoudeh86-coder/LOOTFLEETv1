-- =============================================================================
--  lb-upsert-canonical.sql — ONE lb_upsert, no ambiguity              (run once)
--  ---------------------------------------------------------------------------
--  THE BUG: leaderboard.sql created lb_upsert(text,bigint,int,int,bigint,jsonb)
--  and pilot-ascension.sql added lb_upsert(...,jsonb,int DEFAULT 0). Both then
--  existed. A 6-argument call matches BOTH candidates (the 7-arg one via its
--  default), so PostgreSQL/PostgREST refuses to choose and the call fails.
--
--  Any client on the 6-arg path — the legacy-signature fallback in cloud.js,
--  latched by one transient error — therefore stopped publishing its leaderboard
--  row entirely. Symptoms on the Ranks page: nobody else's ascension stars, and
--  for some accounts no other players at all.
--
--  THE FIX: drop the legacy overload and keep ONE canonical function whose extra
--  parameter has a default, so 6-arg and 7-arg calls both bind to it. Same
--  pattern as territory-v2.sql's single claim_tile.
--
--  Safe to re-run.
-- =============================================================================

alter table leaderboard add column if not exists asc_stars smallint not null default 0;

-- Drop EVERY older signature (any return type) so only the canonical one remains.
drop function if exists public.lb_upsert(text, bigint, int, int, bigint, jsonb);
drop function if exists public.lb_upsert(text, bigint, int, int, bigint, jsonb, int);

create or replace function public.lb_upsert(
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

grant execute on function public.lb_upsert(text, bigint, int, int, bigint, jsonb, int) to authenticated;

-- The board is world-readable: make sure the read path is intact for both roles.
alter table leaderboard enable row level security;
drop policy if exists "leaderboard_read" on public.leaderboard;
create policy "leaderboard_read" on public.leaderboard for select using (true);
grant select on public.leaderboard to anon, authenticated;

-- ---- verify -----------------------------------------------------------------
-- Exactly ONE row expected:
--   select oid::regprocedure from pg_proc where proname = 'lb_upsert';
-- Rows that never published while the call was ambiguous simply reappear on the
-- owner's next cloud save; nothing needs backfilling.

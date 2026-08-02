-- =============================================================================
--  lb-seed-missing.sql — nobody who plays can be invisible on Ranks   (run once)
--  ---------------------------------------------------------------------------
--  THE BUG (Aug 2026, reported as "Falcor is in the game actively taking tiles
--  and I'm still not seeing him on the leaderboard"):
--
--    leaderboard   ← written ONLY by the player's own client (lb_upsert), and
--                    the client skips it whenever the session lock says this tab
--                    may not write (kicked by a newer login, background tab that
--                    never claimed, unresolved save conflict).
--    territory     ← written by claim_tile(), which has NO session-lock guard.
--    sdread_scores ← same: its own RPC, no guard.
--
--  So a real, active pilot can hold tiles and push the Voidmaw for weeks while
--  never once publishing a leaderboard row. Confirmed for user
--  4e92de83-0c92-48a8-9fe0-c342c69c1846 ("Falcor"): 6 territory claims, Voidmaw
--  stage 36, zero rows in `leaderboard`.
--
--  The client fix ships in build 411 (account.js publishes the public row even
--  from a locked tab; territory.js publishes after every successful claim).
--  This file repairs the players who are ALREADY missing, and adds a database
--  backstop so the class of bug cannot silently recur.
--
--  Safe to re-run. Every write here is INSERT-ONLY (`on conflict do nothing`):
--  it can never overwrite, downgrade or reorder a row a real client published.
-- =============================================================================

-- ---- 0. SAFE POWER CAST ----------------------------------------------------
-- territory.fleet_score is numeric and citadel scores are multiplied, so real
-- values run past 1e25 — far beyond bigint (max 9.22e18). leaderboard.power is
-- bigint, so clamp instead of casting blind (that raised "22003: bigint out of
-- range" on the first run). Anyone clamped is already top of the board, and
-- their next client publish writes the true value.
create or replace function public.lf_clamp_power(v numeric)
returns bigint language sql immutable as $$
  select least(greatest(coalesce(v, 0), 0), 9223372036854775807::numeric)::bigint;
$$;

-- ---- 1. BACKFILL -----------------------------------------------------------
-- Seed a row for anyone with territory or Voidmaw activity but no board entry.
-- power comes from their most recent territory claim's fleet_score, which the
-- client writes as Math.round(GAME.score()) — the same quantity `power` holds.
-- Citadel and Void tiles carry a defense-multiplied score, so prefer a plain
-- tile when the player holds one; the row self-corrects on their next publish.
with active as (
  select owner_id as user_id, max(owner_name) as name from public.territory
  where owner_id is not null group by owner_id
  union
  select user_id, max(name) from public.sdread_scores
  where user_id is not null group by user_id
),
best as (
  select distinct on (t.owner_id)
         t.owner_id as user_id, t.fleet_score, t.owner_name
  from public.territory t
  where t.owner_id is not null
  order by t.owner_id, t.citadel asc nulls first, t.updated_at desc
)
insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, asc_stars, updated_at)
select a.user_id,
       left(coalesce(b.owner_name, a.name, 'Operator'), 24),
       lf_clamp_power(b.fleet_score),
       1, 1, 0, '[]'::jsonb, 0, now()
from active a
left join best b on b.user_id = a.user_id
where a.user_id is not null
on conflict (user_id) do nothing;

-- ---- 2. BACKSTOP -----------------------------------------------------------
-- First territory claim now guarantees a board row. Insert-only, so the real
-- client publish (name, level, zone, kills, fleet, stars) always wins.
create or replace function public.lb_seed_from_territory()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is null then return new; end if;
  insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, asc_stars, updated_at)
  values (new.owner_id, left(coalesce(new.owner_name,'Operator'),24),
          lf_clamp_power(new.fleet_score), 1, 1, 0, '[]'::jsonb, 0, now())
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_lb_seed_territory on public.territory;
create trigger trg_lb_seed_territory
  after insert or update on public.territory
  for each row execute function public.lb_seed_from_territory();

-- Same for the Voidmaw board — a pilot deep in the event is unmistakably real.
create or replace function public.lb_seed_from_sdread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then return new; end if;
  insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, asc_stars, updated_at)
  values (new.user_id, left(coalesce(new.name,'Operator'),24), 0, 1, 1, 0, '[]'::jsonb, 0, now())
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_lb_seed_sdread on public.sdread_scores;
create trigger trg_lb_seed_sdread
  after insert or update on public.sdread_scores
  for each row execute function public.lb_seed_from_sdread();

-- ---- verify -----------------------------------------------------------------
-- Should return ZERO rows (everyone active is on the board):
--   select a.user_id from (
--     select owner_id as user_id from public.territory where owner_id is not null
--     union select user_id from public.sdread_scores where user_id is not null
--   ) a left join public.leaderboard l using (user_id) where l.user_id is null;
--
-- Falcor specifically:
--   select name, power, level, updated_at from public.leaderboard
--   where user_id = '4e92de83-0c92-48a8-9fe0-c342c69c1846';

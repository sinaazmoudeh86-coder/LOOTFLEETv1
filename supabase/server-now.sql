-- =============================================================================
-- server-now.sql — LOOTFLEET · authoritative clock for the Ascension ceiling
-- -----------------------------------------------------------------------------
-- The Pilot Ascension star ceiling rises one star every Monday 00:00 UTC. Read off
-- the device clock that is not a schedule, it is a suggestion: setting a phone ten
-- weeks forward would hand out ten weeks of ceiling. js/servertime.js anchors on
-- this function instead.
--
-- WHY A FUNCTION AND NOT THE `Date` RESPONSE HEADER. `Date` is not a
-- CORS-safelisted response header, so a browser refuses to expose it to a
-- cross-origin fetch — the client reads null. A function returns it in the body,
-- which the browser will hand over.
--
-- SAFE TO EXPOSE. It takes no arguments, touches no table, reads no row, and
-- returns a single timestamp that is already public information. Callable by
-- `anon` on purpose: the clock has to be readable before a player signs in.
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- STABLE, not IMMUTABLE: the value changes between statements, and marking it
-- immutable would let the planner cache it.
create or replace function public.server_now()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select now();
$$;

comment on function public.server_now() is
  'Authoritative UTC clock for client-side weekly schedules (Pilot Ascension star ceiling). No arguments, reads no data. See js/servertime.js.';

revoke all on function public.server_now() from public;
grant execute on function public.server_now() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- VERIFY — expect one row, a timestamp within a second or two of real UTC.
-- -----------------------------------------------------------------------------
select public.server_now() as server_now;

-- Confirm exactly ONE copy exists. `create or replace function` cannot replace an
-- overload whose argument types differ, so a second definition would silently be
-- ADDED rather than replacing this one — the same trap that put three `lb_upsert`
-- overloads in production. This function takes no arguments, so there is nothing
-- to overload, but the check is cheap and the habit is the point.
select p.oid::regprocedure as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'server_now';

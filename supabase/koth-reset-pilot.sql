-- =============================================================================
--  koth-reset-pilot.sql — WIPE ONE OPERATOR FROM THE KING OF THE HILL LADDER
--  Build 692. Safe to re-run. Safe to run while the event is live.
-- =============================================================================
--
--  WHAT THIS IS FOR. A score that was set under a bug is not a score, and leaving
--  it on the board poisons every ladder position under it — everyone else is
--  ranked against a number nobody can legitimately reach. This removes ONE named
--  operator from the daily race and, optionally, from the Hall of Kings.
--
--  WHY BY NAME AND NOT BY user_id: the name is what the operator knows and what
--  the board shows. Step 1 resolves it to ids and PRINTS them, so a typo removes
--  nothing rather than the wrong person.
--
--  WHAT IT DELIBERATELY DOES NOT TOUCH:
--    · the player's SAVE. Their local koth counters (ack/pend/best) live in the
--      save and are re-synced from the server on the next bump; zeroing the
--      server row is enough and reaching into a save from SQL is not possible
--      here anyway.
--    · koth_awards that were already DELIVERED. A prize the player has already
--      received as mail and spent cannot be clawed back by deleting a row — it
--      would only desync the ledger. Undelivered awards ARE removed.
--    · any other ladder. Power, Territory, Hangar and the rest are untouched.
--
--  SET THE NAME HERE. Case-insensitive, exact match on the whole name. It appears
--  in five places below — find-and-replace 'realsina1' to reset someone else.
--  (No psql \set: the Supabase SQL editor does not support it.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · RESOLVE — who are we about to reset?
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text := 'realsina1';
  r record;
  n int := 0;
begin
  raise notice '--- koth-reset: matching operators for "%" ---', v_name;
  for r in
    select s.user_id, s.name, s.kills, s.day, s.tier, s.flags
      from public.koth_scores s
     where lower(s.name) = lower(v_name)
  loop
    n := n + 1;
    raise notice '  koth_scores: % (%) day=% kills=% tier=% flags=%',
      r.name, r.user_id, r.day, r.kills, r.tier, r.flags;
  end loop;
  if n = 0 then
    raise notice '  no live koth_scores row — nothing to reset on the daily board';
  end if;

  n := 0;
  for r in
    select h.day, h.name, h.kills, h.entrants
      from public.koth_hall h
     where lower(h.name) = lower(v_name)
     order by h.day desc
  loop
    n := n + 1;
    raise notice '  koth_hall: day=% kills=% entrants=%', r.day, r.kills, r.entrants;
  end loop;
  raise notice '  % crown(s) in the Hall of Kings', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · RESET THE DAILY RACE
-- ---------------------------------------------------------------------------
-- Zeroed IN PLACE rather than deleted. The row carries last_seq, and koth_bump
-- refuses any sequence at or below the last one it accepted — delete the row and
-- the counter restarts at 0 while the client is still climbing, so every
-- subsequent submission comes back as a replay and the player silently stops
-- scoring for the rest of the day. Keeping the row and advancing the sequence is
-- the only safe reset while an event is live.
update public.koth_scores s
   set kills      = 0,
       tier       = 1,
       peak_kps   = 0,
       flags      = 0,
       reached_at = now(),
       last_bump  = now(),
       last_seq   = s.last_seq + 1000,   -- stay ahead of anything in flight
       last_res   = null,
       updated_at = now()
 where lower(s.name) = lower('realsina1');

-- ---------------------------------------------------------------------------
-- 3 · UNDELIVERED PRIZES ONLY
-- ---------------------------------------------------------------------------
delete from public.koth_awards a
 where a.delivered = false
   and a.user_id in (select user_id from public.koth_scores where lower(name) = lower('realsina1'));

-- ---------------------------------------------------------------------------
-- 4 · THE HALL OF KINGS — OPTIONAL, COMMENTED OUT BY DEFAULT
-- ---------------------------------------------------------------------------
-- Removing a crown rewrites history and changes the CROWNS ladder for everyone.
-- Uncomment ONLY the crowns that were won under the bug. koth_hall.day is the
-- primary key, so name the days explicitly rather than deleting by name — that
-- way a legitimate older crown is not swept up with a tainted recent one.
--
--   delete from public.koth_hall where day in (20685, 20686);
--
-- To remove every crown this operator holds:
--
--   delete from public.koth_hall where lower(name) = lower('realsina1');

-- ---------------------------------------------------------------------------
-- 5 · CONFIRM
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select s.name, s.kills, s.tier, s.last_seq
      from public.koth_scores s
     where lower(s.name) = lower('realsina1')
  loop
    raise notice 'koth-reset: % now kills=% tier=% last_seq=%', r.name, r.kills, r.tier, r.last_seq;
  end loop;
end $$;

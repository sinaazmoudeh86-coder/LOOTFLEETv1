-- =============================================================================
--  reset-ascension-board.sql — SEASON RESET, leaderboard half
-- -----------------------------------------------------------------------------
--  SYMPTOM: a pilot has reset to 0 stars in-game and says so, but the Ranks
--  board still shows their old count (e.g. FrostyKill at 49).
--
--  CAUSE: `leaderboard.asc_stars` is deliberately MONOTONIC on the server, in
--  two independent places, for the same reason the client save-merge is:
--
--    1. lb_upsert  →  asc_stars = greatest(l.asc_stars, excluded.asc_stars)
--       The client IS publishing 0. greatest(49, 0) is 49. The row never moves.
--
--    2. trigger trg_lb_sync_asc on public.saves  →  only ever RAISES asc_stars
--       from the save blob, so it cannot correct a row downward either.
--
--  Power, level, zone, kills, tiles and citadels all use `excluded.*` and self-
--  correct on the next publish. `asc_stars` is the ONLY stuck column.
--
--  This file does three things:
--    A. zeroes the column for every human row,
--    B. makes both write paths able to go DOWN, so this settles by itself now
--       and at any future reset,
--    C. (optional) resets the simulated pilots, or the Ascension ladder ends up
--       ranking nothing but bots.
--
--  ⚠ SAME TWO-PASS RULE AS THE TERRITORY WIPE. Run STEP A, push/finish the
--  rollout, wait ~10 minutes, run STEP A again. Until every client is on build
--  582 an old one can still publish p_asc = 49 and re-raise its own row. STEP B
--  makes the second pass permanent rather than another temporary floor.
-- =============================================================================

-- ---- A. zero every human row. RUN THIS TWICE (see header). ------------------
update public.leaderboard set asc_stars = 0 where asc_stars <> 0;

-- ---- B. let both write paths lower the value --------------------------------
--
--  ⚠ THE lb_upsert EDIT BELOW IS OPTIONAL. Read this before hand-editing SQL.
--  Once every client is on build 582 it publishes p_asc = 0, and greatest(0, 0)
--  is 0 — so the existing greatest() is harmless from then on. STEP A plus the
--  trigger replacement further down is the whole fix. The function edit only
--  buys two things: protection during the rollout window (a straggler on an old
--  build re-raising its own row), and one less thing to remember at the next
--  reset. Skip it if you would rather not hand-edit a function.
--
-- lb_upsert: trust a NON-NULL p_asc outright. The null case is untouched, which
-- is what the original greatest() was really protecting — cloud.js latches
-- `_lbNoAsc` and publishes the 6-arg row (p_asc null) for 6 hours after a failed
-- 7-arg call, and that path must still leave the stored value alone.
--
-- NOTE: your project may be running lb_upsert from lb-upsert-canonical.sql,
-- cargo-ladder.sql, or nanocore-ladder.sql — whichever migration ran last wins.
-- This patches the column rule without redefining the whole function, so it is
-- safe whichever one is live. Find it with:
--   select p.oid::regprocedure from pg_proc p
--    where p.proname = 'lb_upsert';
--
-- Then in that function body, change the asc_stars line from:
--     asc_stars = case when p_asc is null then l.asc_stars
--                      else greatest(l.asc_stars, excluded.asc_stars) end,
-- to:
--     asc_stars = case when p_asc is null then l.asc_stars
--                      else excluded.asc_stars end,
--
-- (lb-upsert-canonical.sql has no null-check at all — its line is just
--  `asc_stars = greatest(l.asc_stars, excluded.asc_stars),` — change that to
--  `asc_stars = excluded.asc_stars,`.)

-- The saves trigger is self-contained, so it CAN be replaced outright here.
-- The save blob is the authoritative count (game-v93.js owns it), so the
-- leaderboard should simply match it in both directions.
create or replace function public._lb_sync_asc()
returns trigger language plpgsql security definer set search_path = public as $$
declare n smallint;
begin
  n := least(32767, greatest(0, coalesce(
         nullif(new.data #>> '{pasc,stars}', '')::numeric, 0)))::smallint;
  -- SET, not greatest(). A reset is a legitimate downward move and the save is
  -- the source of truth; refusing to follow it down is what pinned rows at
  -- their pre-reset star count.
  update public.leaderboard
     set asc_stars = n
   where user_id = new.user_id and asc_stars <> n;
  return new;
exception when others then return new;   -- never let a bad save blob block a save
end $$;

-- ---- C. simulated pilots (optional, but read this) --------------------------
-- Sims are NOT reset by anything above. They run their own prestige loop, so
-- after a human reset the Ascension ladder is every bot at 20-49 stars and every
-- real pilot at 0 — which reads as "the reset didn't work".
--
-- sim_rivals() anchors the rival pack to max(leaderboard.asc_stars), so the
-- RIVAL sims will drift to 0 on their own at the next cron. Ordinary sims will
-- not. Uncomment to put the whole simulated roster on the same clean slate:
--
--   update public.sim_pilots
--      set asc_stars = 0, asc_points = 0, asc_mult = 1.0,
--          asc_target = least(500, greatest(125, asc_target));
--
-- Leave it commented if you would rather the board keep a visible top end while
-- real pilots climb back.

-- ---- verify ------------------------------------------------------------------
-- Every human row against what their save actually claims. `stars_in_save` and
-- `asc_stars` must agree on every line.
select l.name, l.asc_stars, (s.data #>> '{pasc,stars}') as stars_in_save
  from public.leaderboard l
  left join public.saves s on s.user_id = l.user_id
 where coalesce(nullif(s.data #>> '{pasc,stars}', '')::numeric, 0) <> l.asc_stars
 order by l.asc_stars desc
 limit 50;
-- Expect ZERO rows. Any row listed here is still out of sync.

-- Highest star count still on the board, human and sim:
select 'human' as who, coalesce(max(asc_stars), 0) as stars from public.leaderboard
union all
select 'sim', coalesce(max(asc_stars), 0) from public.sim_pilots where active;

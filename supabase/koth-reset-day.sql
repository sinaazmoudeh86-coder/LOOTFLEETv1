-- =============================================================================
--  koth-reset-day.sql — WIPE TODAY'S KING OF THE HILL BOARD, EVERYONE
--  Build 702. Run once in the SQL Editor. Safe to run while the event is live.
-- =============================================================================
--
--  WHY THIS EXISTS. The pend-merge bug (fixed client-side in 702) replayed
--  already-counted kills onto the board for any pilot who logged in from a
--  second device, so today's standings mix real scores with inflated ones and
--  the two cannot be told apart after the fact. A board nobody can trust is
--  worse than a board that restarts: this resets EVERY score for the current
--  day and the race simply begins again at the next kill.
--
--  WHAT IT DOES AND DOES NOT TOUCH:
--    · every koth_scores row is zeroed IN PLACE — kills, tier, flags, peak —
--      never deleted. Deleting the row restarts the server's sequence at 0 while
--      clients keep climbing, which turns every later submission into a refused
--      replay and silently stops those pilots scoring for the day.
--
--    · last_seq is set to 0 rather than ADVANCED. The first version pushed it
--      up by 1000 on the theory that it would fence off anything in flight. It
--      did the opposite: koth_bump only answers "replay" when last_res is
--      non-null, and this script nulls it, so an old client's next flush was
--      accepted normally and re-added the queue it was still holding — the board
--      came back at 458 kills and tier 1168 within seconds of being wiped.
--      Zeroing it instead means a reconciled client (build 705+) resumes at
--      seq 1 with an empty queue and no bounce.
--
--  ORDER MATTERS, AND IT IS THE OPPOSITE OF THE USUAL ONE:
--  DEPLOY BUILD 705 FIRST, THEN RUN THIS. Pre-705 clients ratchet their local
--  total upward only (they never accept a lower server figure), so resetting
--  while they are live just hands the stale count straight back. 705 snaps the
--  local total down to whatever the server says and drops the pending queue with
--  it, which is what makes a wipe stick.
--    · UNDELIVERED prizes for today are removed. Delivered ones are not —
--      a prize already read as mail and spent cannot be clawed back by
--      deleting a ledger row; it can only desync the ledger.
--    · the HALL OF KINGS is untouched. Yesterday's crown was decided before
--      the bug and rewriting history changes the CROWNS ladder for everyone.
--    · pilots' local saves are untouched; their ack reconciles down on the
--      next flush answer automatically.
-- =============================================================================

do $$
declare v_day int := floor(extract(epoch from now()) / 86400)::int; v_n int;
begin
  update public.koth_scores set
    kills = 0, tier = 1, peak_kps = 0, flags = 0,
    reached_at = now(), last_bump = now(),
    last_seq = 0, last_res = null, updated_at = now()
  where day = v_day;
  get diagnostics v_n = row_count;
  raise notice 'koth-reset-day: zeroed % score row(s) for day %', v_n, v_day;

  delete from public.koth_awards where day = v_day and delivered = false;
  get diagnostics v_n = row_count;
  raise notice 'koth-reset-day: removed % undelivered award(s)', v_n;
end $$;

-- Confirm: today's board should be empty.
select count(*) as remaining_scores
  from public.koth_scores
 where day = floor(extract(epoch from now()) / 86400)::int and kills > 0;

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
--      never deleted. The row carries last_seq, and koth_bump refuses any
--      sequence at or below the last accepted; delete the row and the counter
--      restarts at 0 while clients keep climbing, turning every later
--      submission into a refused replay. Advancing the sequence by 1000 clears
--      anything in flight instead.
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
    last_seq = last_seq + 1000, last_res = null, updated_at = now()
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

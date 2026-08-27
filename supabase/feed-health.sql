-- =============================================================================
--  feed-health.sql — WHAT THE LOG ACTUALLY SAYS, AND WHAT TO DO   (READ-ONLY)
-- -----------------------------------------------------------------------------
--  From the 30-minute log sample: two distinct errors, and NEITHER of them is
--  the Discord bot.
--
--    P0001  not authenticated          ~60 hits / 30 min, continuous
--    42883  operator does not exist: record ->> unknown      1 hit
--
--  And one thing that looks fine and proves nothing:
--
--    cron job 4 starting / completed: 1 row      every 2 minutes, always green
--
--  ---------------------------------------------------------------------------
--  1 · WHY THE GREEN CRON LINE IS WORTHLESS
--  ---------------------------------------------------------------------------
--  Cron job 4 IS the Discord feed. `net.http_post` returns a request id the
--  moment the request is QUEUED, so "completed: 1 row" means the row was
--  inserted — not that the function ran, not that it returned 200, not that a
--  single message reached Discord. A green cron log and a silent (or repeating)
--  channel look identical from here. THE FEED'S REAL RESULT IS IN
--  `net._http_response`, and nowhere else. Section 5 reads it.
--
--  ---------------------------------------------------------------------------
--  2 · P0001 `not authenticated` — THE CLIENT, NOT THE BOT
--  ---------------------------------------------------------------------------
--  That string is raised by the auth guard at the top of `lb_upsert`:
--      if auth.uid() is null then raise exception 'not authenticated'; end if;
--  `cloud.js lbUpsert()` walks a CASCADE of ten overload shapes looking for one
--  the server accepts. With no session, every rung raises — so ONE publish
--  attempt produces a burst of errors, and the publish heartbeat runs every 90
--  seconds. That is exactly the shape in the log: clusters of 5-8 errors a few
--  seconds apart, repeating forever. Guests and expired tokens both do it.
--
--  FIXED CLIENT-SIDE in build 727: `lbUpsert()` now returns immediately unless
--  there is a real Supabase session. Not one of those calls could ever have
--  written a row, so the right number of them is zero. Nothing on the server
--  needs changing — and deliberately so: `lb_upsert` is the most overload-
--  sensitive function in this database (see the drop-by-catalogue rule in
--  pilot-ladder.sql), and it is not worth touching to silence a log line.
--
--  Section 4 lists every function that can raise it, in case another caller is
--  doing the same thing.
--
--  ---------------------------------------------------------------------------
--  3 · 42883 `record ->> unknown` — THE TEMPLE, STILL INSTALLED
--  ---------------------------------------------------------------------------
--  This is the retired Temple. `temple_claim()` on this server is the PRE-FIX
--  version whose self-join RETURNING bound a bare `record`, so
--  `v_item->>'rarity'` throws 42883 on every call. The Temple was removed from
--  the CLIENT in build 711 — but removing a screen does not remove an RPC, and
--  stale cached clients keep polling it.
--
--      >>> RUN `supabase/temple-retire.sql` ONCE. <<<
--
--  It drops the temple FUNCTIONS by catalogue lookup and leaves the TABLES
--  alone — `temple_altar` / `temple_presence` / `temple_claims` are the only
--  record of what players did while the arena was live. Nothing reads them, so
--  there is nothing to gain by dropping them and a real history to lose.
--
--  Section 4 also confirms whether the drop worked.
-- =============================================================================


-- =============================================================================
--  4 · WHO CAN RAISE WHAT  (run first — it is instant)
-- =============================================================================
select
  p.proname                                            as function_name,
  case
    when p.prosrc ilike '%not authenticated%' then 'raises P0001 not authenticated'
    else ''
  end                                                  as auth_guard,
  case when p.proname like 'temple%' then 'TEMPLE — should be GONE (run temple-retire.sql)' else '' end as note,
  pg_get_function_identity_arguments(p.oid)            as args
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and (p.prosrc ilike '%not authenticated%' or p.proname like 'temple%')
order by (p.proname like 'temple%') desc, p.proname;

-- Expected after temple-retire.sql: ZERO rows whose name starts with `temple`.
-- Any `temple_*` row still listed is still answering stale clients and still
-- throwing 42883 into this log several times a minute.


-- =============================================================================
--  5 · IS THE FEED ACTUALLY WORKING?  (the only honest answer)
--  Every response the feed has returned, newest first. `content` is the
--  function's own JSON — it carries `ver`, and as of 727 also `sent`, `failed`
--  and `skipped`, which is the only statement of what reached Discord.
-- =============================================================================
select
  r.created                                            as at_utc,
  r.status_code,
  left(coalesce(r.content, r.error_msg, ''), 400)      as body,
  case
    when r.status_code is null      then 'NO RESPONSE — function never answered (timeout / boot failure)'
    when r.status_code >= 500       then 'FUNCTION THREW — cursor may not have advanced'
    when r.status_code = 403        then 'FEED_KEY mismatch — cron header vs the secret'
    when r.content ilike '%"failed":0%' and r.content ilike '%"skipped":0%' then 'clean'
    when r.content ilike '%"failed":0%' then 'posted, some over budget (they ride the sitrep)'
    when r.content is not null and r.content not ilike '%"ok":true%' then 'answered but not ok'
    else 'check failed/skipped in the body'
  end                                                  as verdict
from net._http_response r
order by r.created desc
limit 30;

-- WHICH BUILD IS LIVE? `ver` must read 727. Anything lower means the Edge
-- Function was never redeployed and the fixes below are not running:
--   select left(content, 60) from net._http_response
--    where content ilike '%"ver"%' order by created desc limit 1;


-- =============================================================================
--  6 · WHY IT POSTED OLD THINGS — the cursor's own state
--  `feed_seen` is the feed's memory. Two failure modes show up here:
--    · a KIND with far fewer rows than the live table it tracks → the cursor
--      lost rows, and everything missing reads as brand new next tick
--    · `_meta` cursors with an old updated_at → that stream has not advanced,
--      so its backlog will arrive in one burst when it finally does
-- =============================================================================
select
  kind,
  count(*)                                             as cursor_rows,
  min(updated_at)                                      as oldest,
  max(updated_at)                                      as newest,
  case kind
    when 'pilot'    then (select count(*)::text from public.leaderboard)
    when 'tile'     then (select count(*)::text from public.territory)
    when 'dread'    then (select count(*)::text from public.sdread_scores)
    when 'alliance' then (select count(*)::text from public.alliances)
    else ''
  end                                                  as live_rows,
  case when max(updated_at) < now() - interval '10 minutes'
       then 'STALE — the feed has not written this kind in over 10 minutes' end as flag
from public.feed_seen
group by kind
order by kind;

-- The `_meta` cursors in detail: bootstrap, war, temple, koth, sitrep.
select ref, updated_at, left(data::text, 200) as data
from public.feed_seen where kind = '_meta' order by ref;


-- =============================================================================
--  7 · IF THE CHANNEL IS STILL WRONG
-- =============================================================================
-- Replay from scratch WITHOUT dumping history (the next tick re-bootstraps
-- silently and posts one "FLEET DISPATCH IS LIVE" line):
--   truncate public.feed_seen;
--
-- Pause the feed without deleting anything:
--   update cron.job set active = false where jobname = 'discord-feed';
--
-- Is it even scheduled, and is job 4 really this one?
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--
-- Force one tick by hand and read the answer immediately:
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/discord-feed',
--     headers := jsonb_build_object('Content-Type','application/json','x-feed-key','<FEED_KEY>'),
--     body    := '{}'::jsonb, timeout_milliseconds := 20000);
--   -- then, a few seconds later:
--   select status_code, left(content, 400) from net._http_response
--    order by created desc limit 1;

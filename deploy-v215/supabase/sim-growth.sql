-- =============================================================================
--  sim-growth.sql — keep the simulated population climbing
--  ---------------------------------------------------------------------------
--  DIAGNOSIS (Aug 3 2026). The sim system was never broken:
--
--    sim_pilots active     108
--    spawned_today          15  (full budget)
--    spawn_day      2026-08-03  ← the hourly cron IS running
--    target_population     250
--
--  What looked like "stuck at 60" was the CLIENT board cap (BOARD_ROWS = 60 in
--  js/sim-pilots.js), not the roster. 17 humans + 43 sims = 60 rows, forever,
--  regardless of how many pilots existed. That is fixed client-side.
--
--  This file only raises the ceilings, so growth doesn't stall at 250 and the
--  board can show more than 100 sims once it gets there.
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. RAISE THE TARGETS ---------------------------------------------------
--   target_population  250 → 600   the roster keeps climbing instead of parking
--   daily_spawn_min/max 5-15 → 8-22 faster fill, still never a visible burst
--   max_top100          25 → 60    sim_board() returns max_top100 * 4 rows, so
--                                  this is what lets the page show 125 at all
select sim_admin_set('{
  "target_population": 600,
  "daily_spawn_min": 8,
  "daily_spawn_max": 22,
  "max_top100": 60
}'::jsonb);

-- ---- 2. TOP UP TO THE NEW FLOOR ---------------------------------------------
-- One-off catch-up so the board fills tonight rather than over three weeks.
-- Spread deliberately: sim_spawn respects max_population and the active count.
select sim_spawn(60, 'catchup');

-- ---- 3. CONFIRM THE CRON IS REALLY THERE ------------------------------------
-- simulated-pilots.sql ships with this COMMENTED OUT, so it is worth proving it
-- was scheduled by hand at some point. Expect one row, active = true.
select jobname, schedule, active from cron.job where jobname = 'lf-sim-tick';

-- If that returns NOTHING, the roster has been growing only because someone ran
-- sim_tick() manually. Schedule it:
--
--   create extension if not exists pg_cron;
--   select cron.schedule('lf-sim-tick', '7 * * * *', $CRON$ select sim_tick() $CRON$);

-- ---- 4. WHERE THINGS STAND --------------------------------------------------
select
  (select count(*) from sim_pilots where active)                                as sim_active,
  (select count(*) from leaderboard)                                            as humans_total,
  (select count(*) from leaderboard where updated_at > now() - interval '24 hours') as humans_24h,
  (select count(*) from leaderboard where updated_at > now() - interval '7 days')   as humans_7d,
  (select target_population from sim_config)                                    as target,
  (select spawned_today || '/' || spawn_budget from sim_config)                 as today;

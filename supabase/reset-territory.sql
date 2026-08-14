-- =============================================================================
--  reset-territory.sql — SEASON RESET, server half (pairs with build 582)
-- -----------------------------------------------------------------------------
--  Clears ALL galaxy ownership for EVERY player: plain tiles, Void spires,
--  House Citadel holds and player-built citadels with their levels and defense
--  snapshots. They are all rows in ONE table — `public.territory` — because the
--  Void spires and the three casino holds are real tiles, not a separate system.
--
--  ⚠ ORDER MATTERS. Run this THREE-STEP sequence or the map refills itself.
--
--    1. Run STEP 1 below (the truncate).
--    2. Push the site with build 582 and let the update gate evict everyone
--       (~90 seconds). Every client wipes its local mirror on load and latches
--       `_turfRepub2`, which permanently retires republishOwnedTiles().
--    3. Wait ~10 minutes, then run STEP 1 AGAIN.
--
--  Why twice: between the truncate and the eviction, clients still on the old
--  build hold a populated `ownedSystems` and will re-publish it into the empty
--  table. That window is bounded by the update gate. The second truncate clears
--  whatever slipped through, and by then no client has local tiles or a live
--  republish path, so the table stays empty until someone captures fresh ground.
--
--  Running STEP 1 a third time is harmless. Running it BEFORE the site is
--  pushed, and never again, is the one sequence that silently fails.
-- =============================================================================

-- ---- STEP 0 (optional) — keep a copy you can point at in a dispute ----------
-- Comment out if you do not want the archive. It is cheap and it is the only
-- record of who held what; there is no other backup of this table.
create table if not exists public.territory_prereset_s1 as
  select *, now() as archived_at from public.territory;

-- ---- STEP 1 — the wipe. THIS IS THE ONE YOU RUN TWICE. ----------------------
-- `delete` rather than `truncate`: territory is referenced by policies and, on
-- some projects, by foreign keys from war/claim tooling. delete respects them
-- and is fast enough at this table's size.
delete from public.territory;

-- ---- verify -----------------------------------------------------------------
-- Expect 0. If STEP 1 was run before the site push, this will climb again as
-- old clients republish — that is the failure mode the second run exists for.
select count(*) as tiles_held from public.territory;

-- =============================================================================
--  DELIBERATELY NOT TOUCHED — read before you add anything here.
-- -----------------------------------------------------------------------------
--  public.casino_payouts     — money OWED to players from house-citadel shares.
--                              Deleting it takes winnings nobody agreed to give
--                              up. The holds change hands; the debt stands.
--  public.casino_day_losses  — the pooled daily figure the payout maths reads.
--  public.casino_citadels    — CC1/CC2/CC3 definitions and payout bookkeeping.
--                              Ownership of those holds lives in `territory`
--                              and is cleared by STEP 1; deleting these rows
--                              would remove the holds from the game entirely.
--  public.war_events         — the war feed. A log of things that happened, and
--                              they did happen. Clear it only if a feed full of
--                              captures on now-neutral tiles reads badly:
--                                  delete from public.war_events;
--  public.leaderboard        — self-heals. Every client republishes its row
--                              within ~90s of loading, so tile counts and
--                              territory revenue correct themselves. No action.
--  public.saves              — never touch. The client migration rewrites each
--                              save on load; editing the blobs here races it.
-- =============================================================================

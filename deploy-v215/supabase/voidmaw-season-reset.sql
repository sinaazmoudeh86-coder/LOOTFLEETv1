-- =============================================================================
--  voidmaw-season-reset.sql — LOOTFLEET · run once with the 456+ rebalance deploy
--  Supabase → SQL Editor → paste → Run. Safe to re-run (archive is if-not-exists,
--  reset is idempotent).
--
--  WHY. The galaxy-wide number rebalance (build 456) scaled damage from ~1e29
--  magnitudes down to billions/trillions. Season 1 Voidmaw rows in sdread_scores
--  were earned at PRE-rebalance damage, and sdread_upsert() is deliberately
--  ratcheted (total/stage only climb) — so old rows would sit unbeatable at the
--  top of the season board forever, and no post-rebalance run could ever move
--  them. The season restarts on the new scale.
--
--  Event Coins, LootCoins, Voidmaw parts and claimed prizes are CLIENT-side and
--  are NOT touched — nobody loses anything already paid out.
-- =============================================================================

-- 1. archive the pre-rebalance standings (for reference / disputes)
create table if not exists public.sdread_scores_s1_prescale as
  select *, now() as archived_at from public.sdread_scores;

-- 2. reset the live season board to the new scale
update public.sdread_scores
   set best_day = 0, total = 0, stage = 1, day = 0, updated_at = now();

-- 3. verify — top of the season board should be all zeros now
select name, total, stage, best_day from public.sdread_scores
 order by total desc limit 10;

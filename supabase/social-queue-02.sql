-- =============================================================================
--  social-queue-02.sql — SEED · BATCH 02 (10 cards: action shots + feature panels)
-- -----------------------------------------------------------------------------
--  Run AFTER social-queue.sql (it owns the table DDL). Safe to re-run:
--  ON CONFLICT (slug) DO NOTHING — never duplicates, never re-arms a posted row.
--  Schedule: continues the 2/day 15:00 & 23:00 UTC cadence starting the day
--  AFTER the last row already in the queue, so batches never overlap.
-- =============================================================================
with base as (
  select date_trunc('day', coalesce(max(due_at), now())) + interval '1 day' as d0
  from public.social_queue
)
insert into public.social_queue (slug, kind, caption, image_url, due_at)
select v.slug, 'card', v.caption, v.image_url, base.d0 + v.off from base, (values
  ('act-zone41', 'Zone 41. 8,402 kills. The swarm keeps coming and the numbers keep growing — how deep can you push? Play free in your browser → lootfleet.com #spacegame #browsergame #indiegame #lootfleet', 'https://lootfleet.com/social/png/act-zone41.png', interval '0 days 15 hours'),
  ('feat-progression', 'From scrappy Frigate to Titan Carrier — 10 hull classes, 47 hulls, one evolving fleet. Beat bosses, bank blueprints, evolve → lootfleet.com #lootfleet #spacegame #progression', 'https://lootfleet.com/social/png/feat-progression.png', interval '0 days 23 hours'),
  ('feat-loot', 'Every kill can drop an upgrade. 12 rarities, 6 slots, a loot magnet that vacuums the whole haul → lootfleet.com #lootfleet #spacegame #lootgame', 'https://lootfleet.com/social/png/feat-loot.png', interval '1 days 15 hours'),
  ('act-boss', 'The meter hits zero and something BIG warps in. Every zone ends in a boss, every boss drops the good stuff → lootfleet.com #lootfleet #spacegame #bossfight', 'https://lootfleet.com/social/png/act-boss.png', interval '1 days 23 hours'),
  ('feat-fleet', 'One flagship, four escorts, and every single one of them fights. Fleet share, live carrier wings, repair pulses → lootfleet.com #lootfleet #spacegame #fleetbuilding', 'https://lootfleet.com/social/png/feat-fleet.png', interval '2 days 15 hours'),
  ('act-cargo', 'Ten minutes. One freighter. Everything in the sector wants it dead. Cargo Defense is hand-flown escort duty at its meanest → lootfleet.com #lootfleet #spacegame #towerdefense', 'https://lootfleet.com/social/png/act-cargo.png', interval '2 days 23 hours'),
  ('feat-galaxy', 'A shared galaxy of real players. Siege their tiles, seize their citadels INTACT, collect the income → lootfleet.com #lootfleet #spacegame #territorywar', 'https://lootfleet.com/social/png/feat-galaxy.png', interval '3 days 15 hours'),
  ('act-kaevith', 'The Kaevith invaded the wrong galaxy. Clear their zones, fly their crystal hulls, stack +160% fleet XP → lootfleet.com #lootfleet #spacegame #alieninvasion', 'https://lootfleet.com/social/png/act-kaevith.png', interval '3 days 23 hours'),
  ('feat-idle', 'Log off. Your fleet doesn''t. Offline battle sim, moon mines, hourly territory income — the grind runs 24/7 → lootfleet.com #lootfleet #idlegame #spacegame', 'https://lootfleet.com/social/png/feat-idle.png', interval '4 days 15 hours'),
  ('act-ascend', 'Hit the ceiling, burn it all down, keep the stars. Pilot Ascension turns every reset into permanent power → lootfleet.com #lootfleet #spacegame #prestige', 'https://lootfleet.com/social/png/act-ascend.png', interval '4 days 23 hours')
) as v(slug, caption, image_url, off)
on conflict (slug) do nothing;

select slug, due_at, status from public.social_queue order by due_at;

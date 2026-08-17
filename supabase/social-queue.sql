-- =============================================================================
--  social-queue.sql — THE AUTO-POSTING QUEUE (Buffer pipeline)
-- -----------------------------------------------------------------------------
--  One row = one social post: a caption, a hosted image URL, and when it goes
--  out. The social-post Edge Function (cron) drains due rows and creates the
--  posts in Buffer via its GraphQL API — one Buffer post per configured channel.
--
--  Image URLs point at the game site itself (lootfleet.com/social/png/…): the
--  PNGs ship in the deploy folder, so pushing the site is what publishes the
--  media. Buffer requires publicly fetchable URLs, which these are.
--
--  SECURITY: service-role only. No RLS policy grants anon or authenticated
--  anything — the table is invisible to game clients. The Edge Function talks
--  to it with the service key.
--
--  Safe to re-run: idempotent DDL, and the seed uses ON CONFLICT DO NOTHING
--  keyed on slug so re-running never duplicates or re-arms a posted row.
-- =============================================================================

create table if not exists public.social_queue (
  id          bigint generated always as identity primary key,
  slug        text not null unique,          -- card id; the idempotency key
  kind        text not null default 'card',  -- card | announce | patch
  caption     text not null,
  image_url   text not null,
  due_at      timestamptz not null,          -- when it should be handed to Buffer
  status      text not null default 'queued' -- queued | posted | failed | skipped
              check (status in ('queued','posted','failed','skipped')),
  posted_at   timestamptz,
  buffer_ids  jsonb,                         -- Buffer post ids, one per channel
  error       text,
  created_at  timestamptz not null default now()
);

alter table public.social_queue enable row level security;
-- no policies on purpose: service role bypasses RLS, everyone else sees nothing

create index if not exists social_queue_due on public.social_queue (status, due_at);

-- ---- SEED · BATCH 01 --------------------------------------------------------
-- 20 cards, 2/day at 15:00 & 23:00 UTC. Captions mirror social/batch-01.json
-- (the generator source). due_at values are relative to the day this file is
-- run: the batch starts TOMORROW and runs 10 days.
insert into public.social_queue (slug, kind, caption, image_url, due_at) values
  ('weapon-classes', 'card', 'Six weapon classes. One right answer for YOUR build. ⌁ Full field manual on the site — play free in your browser → lootfleet.com #spacegame #browsergame #indiegame #lootfleet', 'https://lootfleet.com/social/png/weapon-classes.png', date_trunc('day', now()) + interval '1 days 15 hours'),
  ('power-math', 'card', 'Same rarity? Class wins. Two tiers apart? Rarity wins. The loot math that settles every drop → lootfleet.com #lootfleet #spacegame #gamingtips #browsergame', 'https://lootfleet.com/social/png/power-math.png', date_trunc('day', now()) + interval '1 days 23 hours'),
  ('fleet-share', 'card', 'Your bench is not decoration. Escort hulls feed 30% of their mods, gear — and now their fighter wings — into the fight. Build the whole fleet → lootfleet.com #lootfleet #spacegame #fleetbuilding', 'https://lootfleet.com/social/png/fleet-share.png', date_trunc('day', now()) + interval '2 days 15 hours'),
  ('carrier-ladder', 'card', '4 bays → 6 → 7 → 11. The Fighter Carrier ladder runs from the Vanguard to the Celestial Corvus, and the first two are earnable FREE on the Tour of Duty → lootfleet.com #lootfleet #spacegame #carriers', 'https://lootfleet.com/social/png/carrier-ladder.png', date_trunc('day', now()) + interval '2 days 23 hours'),
  ('kaevith-stack', 'card', 'Clear invaded zones, earn alien hulls, stack +160% XP for your ENTIRE fleet. The Kaevith Incursion is live → lootfleet.com #lootfleet #spacegame #alieninvasion', 'https://lootfleet.com/social/png/kaevith-stack.png', date_trunc('day', now()) + interval '3 days 15 hours'),
  ('mixed-volleys', 'card', 'Stop hoarding one weapon type. Multi-hardpoint hulls fire EVERYTHING you mount, every cycle → lootfleet.com #lootfleet #gamingtips #spacegame', 'https://lootfleet.com/social/png/mixed-volleys.png', date_trunc('day', now()) + interval '3 days 23 hours'),
  ('moon-basics', 'card', 'Build it once, it pays forever. Mines produce while you''re offline — just keep the pirates off them. Moon colonies in Loot Fleet → lootfleet.com #lootfleet #idlegame #spacegame', 'https://lootfleet.com/social/png/moon-basics.png', date_trunc('day', now()) + interval '4 days 15 hours'),
  ('ship-vanguard', 'card', 'Zero cannons. Four fighters that think for themselves. The Vanguard is free at Tour of Duty level 40 → lootfleet.com #lootfleet #spacegame #newship', 'https://lootfleet.com/social/png/ship-vanguard.png', date_trunc('day', now()) + interval '4 days 23 hours'),
  ('ship-praetorian', 'card', 'The Tour of Duty ends at level 100 — and this is what''s waiting. Dread Praetorian: 4 cannons, 6 fighter bays, 96 drones → lootfleet.com #lootfleet #spacegame #endgame', 'https://lootfleet.com/social/png/ship-praetorian.png', date_trunc('day', now()) + interval '5 days 15 hours'),
  ('ship-aquila', 'card', 'Seven bays. Five cannons. Zero speed penalty. The Titan Aquila is in final trials → lootfleet.com #lootfleet #spacegame #comingsoon', 'https://lootfleet.com/social/png/ship-aquila.png', date_trunc('day', now()) + interval '5 days 23 hours'),
  ('ship-corvus', 'card', '11 fighter bays. 25 fitted slots. The Celestial Corvus doesn''t chase the fight — it brings it. In final trials → lootfleet.com #lootfleet #spacegame #comingsoon', 'https://lootfleet.com/social/png/ship-corvus.png', date_trunc('day', now()) + interval '6 days 15 hours'),
  ('ship-godshard', 'card', 'You can''t buy it. The Kaevith Godshard is earned deep in the Incursion — 7 hardpoints, 30 drones, +64% XP for your whole fleet → lootfleet.com #lootfleet #spacegame #alientech', 'https://lootfleet.com/social/png/ship-godshard.png', date_trunc('day', now()) + interval '6 days 23 hours'),
  ('ship-aegis', 'card', 'It doesn''t shoot. It keeps everything else alive. The Aegis mounts Warden arrays at DOUBLE strength → lootfleet.com #lootfleet #spacegame #supportmain', 'https://lootfleet.com/social/png/ship-aegis.png', date_trunc('day', now()) + interval '7 days 15 hours'),
  ('ship-voidmaw', 'card', 'Yes, it opens black holes on hit. The Voidmaw — Season 1''s event flagship → lootfleet.com #lootfleet #spacegame #blackhole', 'https://lootfleet.com/social/png/ship-voidmaw.png', date_trunc('day', now()) + interval '7 days 23 hours'),
  ('tip-no-oneshot', 'card', 'One hit can NEVER take more than 22% of your hull. The swarm can still get you though → lootfleet.com #lootfleet #gamingtips #spacegame', 'https://lootfleet.com/social/png/tip-no-oneshot.png', date_trunc('day', now()) + interval '8 days 15 hours'),
  ('tip-tour-prorate', 'card', 'Tour of Duty respects your grind: buying a level only charges the XP you''re MISSING. 40/100 → 600 ◈ → lootfleet.com #lootfleet #seasonpass #spacegame', 'https://lootfleet.com/social/png/tip-tour-prorate.png', date_trunc('day', now()) + interval '8 days 23 hours'),
  ('tip-citadel-capture', 'card', 'Win the tile, keep the fortress — at FULL rank. Citadel warfare in My Galaxy → lootfleet.com #lootfleet #spacegame #territorywar', 'https://lootfleet.com/social/png/tip-citadel-capture.png', date_trunc('day', now()) + interval '9 days 15 hours'),
  ('tip-escort-wings', 'card', 'Patch 666: carriers on your BENCH now launch their own fighter wings. The whole fleet fights → lootfleet.com #lootfleet #spacegame #patchnotes', 'https://lootfleet.com/social/png/tip-escort-wings.png', date_trunc('day', now()) + interval '9 days 23 hours'),
  ('tip-loot-magnet', 'card', 'Stop fetching. Anything within magnet range flies to YOU — and pickup radius gear widens the vacuum → lootfleet.com #lootfleet #gamingtips #spacegame', 'https://lootfleet.com/social/png/tip-loot-magnet.png', date_trunc('day', now()) + interval '10 days 15 hours'),
  ('tip-settings-persist', 'card', 'Ascend fearlessly — your loot filters, autopilot and QoL settings all carry over. Only the run resets → lootfleet.com #lootfleet #spacegame #ascension', 'https://lootfleet.com/social/png/tip-settings-persist.png', date_trunc('day', now()) + interval '10 days 23 hours')
on conflict (slug) do nothing;

-- ---- verify -----------------------------------------------------------------
select 'social queue ready' as status,
       count(*) filter (where status = 'queued') as queued,
       min(due_at) as first_post,
       max(due_at) as last_post
from public.social_queue;

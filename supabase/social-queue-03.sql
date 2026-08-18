-- =============================================================================
--  social-queue-03.sql — SEED · BATCH 03 (45 HULL DOSSIERS — one per ship)
-- -----------------------------------------------------------------------------
--  Run AFTER social-queue.sql. Safe to re-run (ON CONFLICT DO NOTHING).
--  Continues the 2/day 15:00 & 23:00 UTC cadence the day after the last queued
--  row, so it lands cleanly behind batches 01 and 02 (~22 more days of posts).
-- =============================================================================
with base as (
  select date_trunc('day', coalesce(max(due_at), now())) + interval '1 day' as d0
  from public.social_queue
)
insert into public.social_queue (slug, kind, caption, image_url, due_at)
select v.slug, 'card', v.caption, v.image_url, base.d0 + v.off from base, (values
  ('hull-frigate', 'Every Titan pilot flew one of these first. Day one, free, yours → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-frigate.png', interval '0 days 15 hours'),
  ('hull-interceptor', '600 kills buys your way off the starter hull. The grind begins → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-interceptor.png', interval '0 days 23 hours'),
  ('hull-cruiser', 'Two hardpoints. Double the fire. The moment the game opens up → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-cruiser.png', interval '1 days 15 hours'),
  ('hull-heavycruiser', 'Plate for days. The first hull that shrugs off a swarm → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-heavycruiser.png', interval '1 days 23 hours'),
  ('hull-destroyer', 'Three cannons, +34% damage, zero apologies → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-destroyer.png', interval '2 days 15 hours'),
  ('hull-battleship', '+45% hull. Parks in the middle of a swarm and stays there → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-battleship.png', interval '2 days 23 hours'),
  ('hull-dreadnought', 'Four hardpoints. The first hull that makes zones feel small → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dreadnought.png', interval '3 days 15 hours'),
  ('hull-carrier', 'Your first drone screen. The fleet stops being just you → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-carrier.png', interval '3 days 23 hours'),
  ('hull-supercarrier', '39,000 kills deep, the swarm starts working for YOU → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-supercarrier.png', interval '4 days 15 hours'),
  ('hull-titan', '4 BILLION gold. 60,000 kills. The standard ladder ends here — everything past it must be TAKEN → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-titan.png', interval '4 days 23 hours'),
  ('hull-aegis', 'It barely fires. It doesn’t need to — the whole fleet heals around it → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-aegis.png', interval '5 days 15 hours'),
  ('hull-vanguard', 'No cannons. Four fighter bays that hunt on their own. Tour level 40, free track → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-vanguard.png', interval '5 days 23 hours'),
  ('hull-chromafang', 'Every bolt is a rainbow. Every kill is a light show → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-chromafang.png', interval '6 days 15 hours'),
  ('hull-chromaregent', 'Titan-class power wrapped in rose quartz, firing pure spectrum → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-chromaregent.png', interval '6 days 23 hours'),
  ('hull-frostyfrost', 'Slow them. Freeze them. Shatter them. Cryo cannons at Titan grade → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-frostyfrost.png', interval '7 days 15 hours'),
  ('hull-titansina', 'The price tag IS the flex: one million LootCoins, flat → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-titansina.png', interval '7 days 23 hours'),
  ('hull-mothership', 'You can’t buy it with gold. Only the territory war pays in the currency this takes → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-mothership.png', interval '8 days 15 hours'),
  ('hull-veridian', 'No shop sells it. A thousand missions, logged one at a time → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-veridian.png', interval '8 days 23 hours'),
  ('hull-voidmaw', 'Eight cannons. Fourteen drone bays. Built piece by piece from an event that doesn’t wait for you → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-voidmaw.png', interval '9 days 15 hours'),
  ('hull-monolith1', '+20% siege damage, carved from Hollow Armada wreckage. Alliance members only → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-monolith1.png', interval '9 days 23 hours'),
  ('hull-monolith2', '+35% vs citadels and bosses. Fortifications hate it → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-monolith2.png', interval '10 days 15 hours'),
  ('hull-monolith3', 'Five cannons, a drone screen, +50% vs everything fortified → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-monolith3.png', interval '10 days 23 hours'),
  ('hull-monolith4', 'Dread-grade mass, all of it aimed at your citadel walls → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-monolith4.png', interval '11 days 15 hours'),
  ('hull-oblivionspear', 'A MILLION kills to qualify. Then you wait two real weeks while the yard builds it → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-oblivionspear.png', interval '11 days 23 hours'),
  ('hull-oblivionspearalpha', 'Two million Spear kills, a king’s ransom, and a MONTH of yard time → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-oblivionspearalpha.png', interval '12 days 15 hours'),
  ('hull-oblivionfinal', 'Rendered at colossal scale with a reactor aura you can see across the map → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-oblivionfinal.png', interval '12 days 23 hours'),
  ('hull-dread1', 'Level 100 unlocks the right to even PAY for it — and it costs every currency at once → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dread1.png', interval '13 days 15 hours'),
  ('hull-dread2', 'Strictly superior to the Reaver, and twice the cores → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dread2.png', interval '13 days 23 hours'),
  ('hull-dread3', 'Leviathan-scale. The lesser Dreads look like escorts next to it → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dread3.png', interval '14 days 15 hours'),
  ('hull-dread4', 'The name is the threat. 72 bays deep → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dread4.png', interval '14 days 23 hours'),
  ('hull-dread5', 'It rewrites battlefields, and it’s still not the top → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dread5.png', interval '15 days 15 hours'),
  ('hull-dread6', 'The level-200 hull. If you see one, its pilot has been here a very long time → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-dread6.png', interval '15 days 23 hours'),
  ('hull-xen1', 'The invasion’s first trophy — and the whole fleet levels faster with it in the hangar → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-xen1.png', interval '16 days 15 hours'),
  ('hull-xen2', 'Cruiser-grade crystal, +16% XP for every ship you own → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-xen2.png', interval '16 days 23 hours'),
  ('hull-xen3', 'A battleship-weight blade — the XP engine of the mid game → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-xen3.png', interval '17 days 15 hours'),
  ('hull-xen4', 'Carrier-class alien command hull. The stack is getting scary → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-xen4.png', interval '17 days 23 hours'),
  ('hull-xen5', 'The Godshard alone lifts every kill’s XP by 64%. All five: +160%, forever → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-xen5.png', interval '18 days 15 hours'),
  ('hull-emb1', 'Obsidian husk, molten seam, and your beacons recharge faster → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-emb1.png', interval '18 days 23 hours'),
  ('hull-emb2', '+15% swarm window, +12% beacon loot. The Choir provides → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-emb2.png', interval '19 days 15 hours'),
  ('hull-emb3', 'Built around a choir-stone that hears beacons before you light them → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-emb3.png', interval '19 days 23 hours'),
  ('hull-emb4', '+40% beacon duration, +35% beacon loot. The swarm comes to YOU → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-emb4.png', interval '20 days 15 hours'),
  ('hull-emb5', 'It doesn’t light beacons. It IS one. +60% loot on every kill it calls → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-emb5.png', interval '20 days 23 hours'),
  ('hull-aeternum', 'An artificial world built to erase star systems. Its lance fires once a minute and leaves the richest loot ground on the map → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-aeternum.png', interval '21 days 15 hours'),
  ('hull-eternum', 'The core is a 2% drop. The hull costs TEN TRILLION. The beams never stop → lootfleet.com #lootfleet #spacegame #shipreveal', 'https://lootfleet.com/social/png/hull-eternum.png', interval '21 days 23 hours'),
  ('hull-praetorian', 'Six bays. Dread plate. First deliveries unannounced → lootfleet.com #lootfleet #spacegame #comingsoon', 'https://lootfleet.com/social/png/hull-praetorian.png', interval '22 days 15 hours'),
  ('hull-titanaquila', 'The apex of the carrier line is coming. Seven bays. Five cannons → lootfleet.com #lootfleet #spacegame #comingsoon', 'https://lootfleet.com/social/png/hull-titanaquila.png', interval '22 days 23 hours'),
  ('hull-corvus', 'ELEVEN fighter bays. Not a warship — an airfield that moves → lootfleet.com #lootfleet #spacegame #comingsoon', 'https://lootfleet.com/social/png/hull-corvus.png', interval '23 days 15 hours')
) as v(slug, caption, image_url, off)
on conflict (slug) do nothing;

select count(*) filter (where status = 'queued') as queued, max(due_at) as last_post from public.social_queue;

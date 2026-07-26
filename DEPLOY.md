# LOOT FLEET V1.0 BETA — Deploy v201 (build 390 · SW cache `lootfleet-v390`)

Push this folder to GitHub → Vercel.

## Database

Nothing here is required to launch — every feature degrades silently without it.
Run in this order when you want the server-side halves:

| # | File | Gives you |
|---|---|---|
| 1 | `supabase/pilot-ascension.sql` | ascension rank badges visible on OTHER players' rows |
| 2 | `supabase/simulated-pilots.sql` | server-side simulated roster (shared across all clients) |
| 3 | `supabase/simulated-pilots-behavior.sql` | their territory, alliances, friends and event activity |
| — | `supabase/notifications.sql` | daily fleet-report email (still gated off in config.live.js) |

Then, for the roster only:

```sql
create extension if not exists pg_cron;
select cron.schedule('lf-sim-tick',   '7 * * * *',    $$ select sim_tick()   $$);
select cron.schedule('lf-sim-behave', '*/15 * * * *', $$ select sim_behave() $$);
select sim_spawn(20);
```

Kill switch: `update sim_config set enabled = false;`

Both sim files are idempotent — re-run them after any update.

---

## What shipped in this release

### Pilot Ascension (prestige)
Command ▸ Pilot Ascension, unlocks at Lv 100. Thin pill across the top of the
Command grid, plus an Ascend button in the battle-screen dock.

* **Points** — pilot level is the spine (Lv 100 = 1, 250 = 2, 500 = 4, 1000 = 8)
  with capped bonuses for fleet score, deepest zone, systems, badges, wing size.
  Live calculator shows every line before you commit.
* **Rank badge** — 5 stars per tier, tier colours following the loot-rarity
  ladder. Rendered on leaderboards, profiles and galaxy defender panels, and
  published to the cloud so other players see yours.
* **Legacy ship** — ONE hull survives, and only the hull: upgrade levels,
  fittings and cargo are all surrendered. Its ascension-module stars remain.
* **Reset** — level, zones, gold, resources, gear, citadels, Void spires, Home
  Citadel, prism, the whole fleet. Territory is *released* so every tile falls
  neutral and undefended with no cooldown. Kept: badges, career counters, perks,
  purchases, Pro, VIP, LootCoins, cosmetics, friends, alliance, mail.
* **12 perks** — 8 permanent multipliers plus 4 beacon perks (below).
* **3 ascension-only loot tiers** — Ascendant ★1, Celestial ★20, Paragon ★50.
  Hard-gated; no zone, boss or crate rolls them below the star requirement.
  Every star also adds +25% weight to Primordial/Relic/Artifact, capped ×5.
* Cinematic: rings collapse, level counter unwinds to 1, star slams in, tier
  reveal. Skippable, honours reduced-motion.

### ◉ Beacon
Manual swarm summon, Zone Grind only, never automated. Circular button above the
speed row with a draining cooldown ring.

* ×50 burst arriving from ~1,500px out and charging in; reinforcements while it
  runs; 45s window; 300s cooldown; field cap 220.
* Defense tree shortens the recharge (−40% cap) and lengthens the call (+150%).
* Four ascension perks stack on top: Distress Relay (recharge), Sustained Signal
  (duration), Wideband Broadcast (size), Wreckfield Tithe (kill value +250%).
* Duration is capped at 66% of the recharge so at least a third of every cycle
  is quiet — the button always has a press moment.

### Simulated pilots
A living cohort that makes the galaxy feel populated. Invisible as bots by
design; `is_simulated` is an internal column only.

* ~1.5 join per hour, filling to 400 over a fortnight. Nothing shows for the
  first 24h.
* Each levels on its own curve from its own join time; power follows from level.
  Top pilot ≈ Lv 160 at one week, Lv 442 at a month, ascending by month three.
* 12-step hull ladder — their ships visibly evolve as they climb.
* Variance: casual/ordinary/committed/pusher paces, 22% plateau chance, ±40%
  gear luck. Level 500 wall → they ascend and restart, like a human.
* Fairness: never rank 1, max 2 in top 10, max 25 in top 100, humans never
  displaced from the visible board, human territory never taken, rewards never
  enter the player economy.

### Fixes in this release
* Defending fleets: combat compared *compressed* scores, square-rooting the real
  power gap. Now de-compressed — the stronger fleet wins from 0.95× upward, and
  defenders run shield repair.
* Starforge: exponential ILVL tariff overflowed to Infinity on deep-zone gear.
  Repriced as fixed costs from pilot level, rarity and item level.
* Account sync: progress-weighted merge, so a weaker device can no longer
  clobber a stronger save. Server-arbitrated session lease.
* Titan Sina and Voidmaw could be re-granted free after every ascension —
  both now behind permanent grant flags.
* Badges keep their claimed ranks and career counters through an ascension.

## Smoke test (2 min)
1. Command shows the Pilot Ascension pill (🔒 Lv 100 below level).
2. Battle screen: ◉ Beacon above the speed row in a Zone Grind; greys to `BOSS`
   during a boss; hidden on galaxy/void tiles.
3. Ranks page lists simulated pilots below the humans, with varied hulls.
4. Ascension ▸ Perks: 12 perks; Loot Tiers shows the two cards.
5. Missions ▸ ⌘ Badges: 1,000-badge ladder, Titan Sina banner.

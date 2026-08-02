# deploy-v207 — build 411

Push the contents of this folder to the repo root Vercel serves, then hard-reload
once so the `lootfleet-v411` service worker takes over.

## Run this SQL first

`supabase/territory-citadel-lv.sql` **must run before the build goes up.**
It adds `territory.citadel_lv` and rebuilds `claim_tile` with the rank
parameter. The new parameter is last and defaults to null, so build 410 clients
keep working while the deploy propagates — and a legacy call leaves an existing
rank alone instead of resetting a rank-5 fortress to 0.

Already run this cycle, listed for the record:

- `lb-seed-missing.sql` — seeds a board row for anyone with territory or Voidmaw
  activity but no leaderboard entry (the Falcor bug)
- `lb-repair-seeded.sql` — fills level/zone/kills/stars on seeded rows from the
  save blob, so a 154B pilot no longer reads "Zone 1 · Lv 1 · 0 kills"

## Changed from v206

| File | Change |
|---|---|
| `js/game-v93.js` | 60s siege clock; citadel rank published on every claim |
| `js/ui-v94.js` | countdown in the siege bar; timeout toast |
| `js/territory.js` | passes `p_citadel_lv` through `claim_tile` |

Build stamps bumped in all 50 cache-bust params, `LF_BUILD`, `sw.js` cache name,
`version.json`, and `index.html`.

## 1 · Siege clock (60s)

Attacking a **live player's Citadel** or **any Void tile** now puts the attacker
on a 60-second clock. `SIEGE_CLOCK` at the top of `game-v93.js` tunes it.

- The clock arms only on the **final** defender. Escort waves are untimed, and a
  player-citadel siege runs their clone fleet first — clearing it doesn't burn
  time, and the clock resets when the fortress powers up.
- NPC citadel siege zones and neutral captures are **not** timed.
- Runs out → the defence holds. Attacker is towed home and the tile is shut to
  them for 15 minutes, so a failed siege can't be retried on a loop.
- HUD shows `⚔ RAZE THE CITADEL · 43s`; the bar turns red under 10s.

The tick runs before the "enemies still alive" early-return in `updateWaveZone`,
which is the state where the citadel is up and shooting back.

## 2 · Citadel rank is now server-visible

`territory.citadel` was a boolean, so rank 1–5 lived only in local saves and
upgrades were invisible to anything server-side. Every claim path now sends the
rank: build, upgrade, seize, warp-claim, and the republish loop.

## 3 · Discord dispatch

Not part of the web deploy — it runs as a Supabase Edge Function. If you have
already deployed it, **redeploy `supabase/functions/discord-feed/index.ts`** to
pick up territory events. Setup and troubleshooting: `DISCORD_FEED_SETUP.md`.

New events: ⚔ SYSTEM TAKEN · ⚑ SYSTEM CLAIMED · ○ SYSTEM ABANDONED ·
▲ CITADEL RAISED / UPGRADED. Tile names are reproduced from the coordinate with
the same seeded generator `galaxy.js` uses, so the feed says "Velor Spire"
rather than "3,-7".

Noise control, since `republishOwnedTiles()` rewrites up to 40 held tiles at a
time: only ownership and rank **changes** are announced (a republish changes
neither), more than 4 tile events from one actor collapse to a single "swept 7
systems" line, and a vanished row needs two consecutive misses before it reads
as abandoned.

## Post-deploy checks

1. Attack a player-held citadel — countdown appears only after their fleet dies.
2. Let it expire — towed home, toast fires, tile shows a 15-minute cooldown.
3. Attack a Void tile — countdown appears on the Warden.
4. Attack an NPC citadel zone — **no** countdown.
5. Build or upgrade a citadel, then check `select tile_id, citadel, citadel_lv
   from territory where citadel` — rank should match what the game shows.
6. Log out, in, and back in twice on a deep-zone account — power and gold
   identical each time. Still the regression that caused the wipes.

## Known, unchanged

- `stripe-webhook` is not deployed. Payment links are live and take money with
  nothing recording or fulfilling it. Check the Stripe Dashboard directly.
- `admin_users` fails with `column reference "user_id" is ambiguous`, so the
  admin panel's Users tab is blank.

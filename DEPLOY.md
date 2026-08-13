# Loot Fleet — deploy v219 · build 571

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v218. Service worker cache is `lootfleet-v571`.

**Headline:** the Nanocore Discord announcements and the Haulage ladder were
written, shipped and never once fired — three separate reads dropped the columns
they depend on. Fixed end to end, plus a new **NANOCORE ladder** in Ranks, a
broken-thumbnail fix on leaderboard rows, and every "now available to attack"
callout removed from Discord.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 571 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `571` |
| Update beacon | `version.json` → `build` | `571` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v571` |
| Project root beacon | root `version.json` (source tree) | `571` |

```bash
grep -o 'LF_BUILD = [0-9]*' game.html; cat version.json; grep -o "lootfleet-v[0-9]*" sw.js
```

Root `sw.js` is NOT a stamp — it is the kill-switch worker for the old poisoned
origin and stays un-versioned. This folder's `sw.js` is the real one.

### Folder audit — all green for this folder

| check | result |
|---|---|
| js/css files `game.html` references | **74** |
| stale vs project root | **0** |
| missing from folder | **0** |
| references without `?v=` | **0** |
| cache-busts raised this release | **7** (only the files that changed) |

Folder was seeded from `deploy-v218`, then `js/`, `css/`, `guides/` and
`supabase/` were **deleted and re-copied from the project root as separate
calls** — never a bulk copy over patched files (the v216 failure).

Files changed: `js/cloud.js`, `js/leaderboard.js`, `js/ranks-boards.js`,
`js/ui-v94.js`, `css/style-v2.css`, `supabase/functions/discord-feed/index.ts`
(build 570) plus `js/cargo-run.js`, `js/cargo-defense.js` (build 571).

---

## Step 1 — SQL (only if `nanocore-ladder.sql` has never been run)

Supabase → SQL Editor → run `supabase/nanocore-ladder.sql`. Safe to re-run.

It adds `nano_legend`, `nano_slots`, `nano_god` to `leaderboard` and re-creates
`lb_upsert` with the three optional params. Without it the Nanocore ladder shows
"waiting on a database migration" and the feed posts nothing — the game itself is
unaffected.

Same applies to `cargo-ladder.sql` if that was never run (Haulage ladder).

## Step 2 — redeploy the Discord feed Edge Function

**This is the fix.** The function has to be redeployed or nothing changes.

```bash
supabase functions deploy discord-feed
```

Confirm the new build is live — the cron log must show `"ver":570`:

```sql
select content from net._http_response order by created desc limit 3;
```

If `ver` reads 565, the old function is still running and no Nanocore card will
ever post.

## Step 3 — push the site

Folder contents to the repo root, commit, let Vercel build. **The site goes
first, the beacon confirms after** — `version.json` in this folder says 571 and
the in-session update gate evicts every connected player onto the new build
within ~90 seconds of Vercel serving it. Never push a beacon bump ahead of the
files it names.

## Step 4 — hard-reload and smoke-test

`Cmd/Ctrl + Shift + R`, then:

1. **Login screen shows `BUILD 571`.**
2. **Ranks → NANOCORE tab exists** (◈, orange) and is one of nine chips that
   wrap without sideways scroll at 360px and on desktop.
3. **Nanocore ladder ranks real pilots**, not just sims. If it says "waiting on a
   database migration", Step 1 was skipped.
4. **Haulage ladder shows non-zero for real pilots** who have delivered. This was
   silently zero for everyone before this build.
5. **No broken-image box** in any leaderboard row's fleet strip (rank 1 was
   showing one).
6. **Discord within ~2 minutes** — the first tick after deploy must post
   **nothing** about Nanocores or cargo. That silence is the backfill guard
   working. Announcements start from the next real change.
7. **No "available to attack" cards** and no shield countdowns in the 3-hour
   situation report.
8. **Cargo run, FIRST of the session** — open Space Cargo Defense, launch, and
   watch the opening five seconds. It should hold frame rate. This was the
   single worst-feeling bug in the game and it only ever reproduced on a cold
   session, so it must be tested on a **hard-reloaded tab**, not a second run.
9. **Cargo clock** — start at 1×, note the countdown, switch to 5×. It should
   drop to roughly a fifth **immediately** and then stay put, not drift for ten
   seconds or bounce up and down.

---

## What shipped in v219 (build 570)

- **The Nanocore + cargo announcements never fired.** The cards were written in
  feed v565 and were dead code. Three reads dropped the columns:
  `cloud.js lbTop` did not select them, `leaderboard.js mapReal` dropped them
  from its row whitelist, and the Edge Function's leaderboard select asked for
  seven columns and never the rest. Every value read `undefined`,
  `Number(undefined) || 0` scored zero on both sides of the diff, and no
  milestone could cross. All three fixed with the cascading fallback the code
  already used, so a server missing a migration degrades instead of erroring.
- **Backfill guard.** Snapshots written before the columns were selected carry no
  such keys at all. Without a guard, the first tick after deploy would fire a
  FIRST LEGENDARY card for every pilot who already owns one, and a full-width
  message for every finished core, all in one batch. Absent keys are adopted
  silently once; announcing starts from the next change.
- **Finished Legendary core gets its own message** — the Kaevith treatment.
  5/5 slots is 25 successful upgrades on one core, the last five at 20% base, on
  a core that drops 1.5% of the time. Never batched, capped at three standalone
  posts per tick.
- **Memes on the loud ones** — first Legendary, finished core and first god roll
  carry a GIF; collection and slot milestones stay text so the channel keeps a
  rhythm. GIF ids are drawn from the pool already in use, so nothing 404s.
- **Scarcity lines** — "the 3rd pilot to recover one", or "the FIRST" when
  nobody else has, computed from rows already in memory. No extra query.
- **Nanocore standing in the situation report** — who holds Legendaries, best
  roll luck, how many finished cores exist.
- **`'nano'` was missing from `PRIORITY`**, sorting to `-1` and outranking
  Kaevith hulls by accident. Placed deliberately now.
- **God-roll odds corrected** — the card claimed "1 roll in 100"; the roll curve
  (`rollBias 2.6`) puts it at ~2%, which is what `nanocores.js` documents.
- **NANOCORE ladder in Ranks** (ninth board). Ranks on Legendary cores
  recovered, ties on the deepest single core built, then on top-5% rolls.
  Simulated pilots get derived figures like every other ladder but are **never**
  handed a finished 5/5 — that row has to be earned by a human.
- **Per-board migration probes.** Haulage and Nanocore ship in their own SQL
  files, but both were gated behind the shared `lb-onefunction` probe — so on a
  server that had run neither, both boards would quietly rank every human at
  zero instead of saying so. Each board now names its own migration in the
  notice.
- **Broken fleet thumbnail** — a published fleet can name a hull this build has
  no art for, and the row rendered the browser's broken-image glyph in the
  flagship slot. Unknown keys are dropped before the tag is written and a 404 on
  a known key removes its own `<img>`, matching every other ship thumbnail in
  the game.
- **"Available to attack" callouts removed from Discord.** Shield-expiry cards,
  the Void spire countdowns and the House Citadel shield timers are all gone: a
  public clock on when a named pilot's tile becomes attackable is a raid
  schedule pointed at whoever is asleep, not a report. Shield state is still
  snapshotted, so it can be brought back without a cursor change. The Void Zone
  and House Citadel sections now list holders only.

## Build 571 — the cargo run report from FrostySkull

- **First run of a session ran at single-digit fps.** The freighter sprite was
  fetched with `new Image()` at the moment the run started, so the download and
  then the PNG **decode** both landed on the main thread inside the first
  seconds of the escort — while the pilot was already being shot at. The two
  lane textures (the collapse-ring disc and the void well) were also baked from
  scratch **every run**, per-pixel, in the same window. Art is now downloaded and
  `decode()`d when the Cargo screen opens, cached for the session, and the
  textures are baked once. Every run after the first was fast because the file
  was cached and decoded — which is exactly why it read as "first run of the
  day".
- **You lost half your hull before you could react.** `GRACE_S` protected the
  FREIGHTER for six seconds and nothing protected the PILOT, so collapse rings
  and void wells did full damage through the launch stall. The pilot is now
  immune to lane hazards for 2.2 **real** seconds after launch.
- **The clock jumped 5:00 → 7:00 → 5:00.** The throughput average was never
  re-seeded when the player changed speed, so switching 1× → 5× kept quoting 1×
  arithmetic for six to eight seconds before sliding — "5 minutes at 1×, 3
  minutes at 5×". The sampler now restarts clean on any speed change, ignores
  the launch spike entirely instead of letting one bad second poison the whole
  run, and the displayed figure is damped: it follows a falling estimate quickly
  but can only climb half a second per update.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` cron succeeded at 00:05; watch sim-held territory.

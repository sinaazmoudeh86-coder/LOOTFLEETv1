# Loot Fleet — deploy v220 · build 574

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v219. Service worker cache is `lootfleet-v574`.

**Headline:** eight bugs from FrostSkull's report, all of them things the game
showed you that were wrong — badge chains that scored a full hangar as zero, a
mob level ceiling that clamped zones to 999, a cargo clock, loot counters, and
the leaderboard drop-outs during the Voidmaw event. Plus a void anomaly banner
that re-fired every 6–9 seconds instead of once per run.

**v219 never went live** — that folder is sealed at 573, so every fix below is
being seen by players for the first time, including the mob level cap removal
that reads as "still capped" in game today.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 574 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `574` |
| Update beacon | `version.json` → `build` | `574` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v574` |
| Project root beacon | root `version.json` (source tree) | `574` |

```bash
grep -o 'LF_BUILD = [0-9]*' game.html; cat version.json; grep -o "lootfleet-v[0-9]*" sw.js
```

Root `sw.js` is NOT a stamp — it is the kill-switch worker for the old poisoned
origin and stays un-versioned. This folder's `sw.js` is the real one. Verified
un-versioned at cut time.

### Folder audit — all green for this folder

| check | result |
|---|---|
| js/css files `game.html` references | **74** |
| stale vs project root | **0** |
| missing from folder | **0** |
| references without `?v=` | **0** |
| references carrying `?v=574` | **7** (only the files that changed) |

Folder was seeded from `deploy-v219`, then `js/`, `css/`, `guides/` and
`supabase/` were **deleted and re-copied from the project root as separate
calls** — never a bulk copy over patched files (the v216 failure). Every
referenced `js`/`css` file was then byte-compared against the project root.

Files changed this build: `js/achievements.js`, `js/game-v93.js`,
`js/cargo-run.js`, `js/account.js`, `js/ui-v94.js`, `js/missions.js`,
`js/cargo-defense.js`.

---

## Step 1 — SQL (only if these have never been run)

Supabase → SQL Editor. Both are safe to re-run and neither is new this release:

- `supabase/nanocore-ladder.sql` — without it the Nanocore ladder shows "waiting
  on a database migration".
- `supabase/cargo-ladder.sql` — same for the Haulage ladder.

Nothing in build 574 needs a migration.

## Step 2 — Discord feed Edge Function (only if v219 was never deployed)

v219 shipped the fix that made Nanocore and cargo announcements fire at all, and
that half lives in the Edge Function, not in this folder. If it was never
deployed:

```bash
supabase functions deploy discord-feed
```

Confirm with the cron log — `"ver"` must read `570` or higher:

```sql
select content from net._http_response order by created desc limit 3;
```

## Step 3 — push the site

Folder contents to the repo root, commit, let Vercel build. **The site goes
first, the beacon confirms after** — `version.json` in this folder says 574 and
the in-session update gate evicts every connected player onto the new build
within ~90 seconds of Vercel serving it. Never push a beacon bump ahead of the
files it names.

## Step 4 — hard-reload and smoke-test

`Cmd/Ctrl + Shift + R`, then:

1. **Login screen shows `BUILD 574`.**
2. **Badges → Fleet Admiral chain counts a stock hangar.** A hull that has never
   been upgraded is Lv 1, so a hangar of stock ships must score one level each,
   not zero. This is the "doesn't count lvl1 ships" report — check the chain's
   progress figure moves the moment a hull is acquired.
3. **Mob levels are not capped at 999.** Check both places the ceiling used to
   bite: the zone card display and the zone launcher. Past level 999 the two must
   agree with each other and with your actual level.
4. **Cargo clock** — start at 1×, note the countdown, switch to 5×. It should
   drop to roughly a fifth immediately and stay put, not drift or bounce.
5. **Loot counters** read the same number on the card and in the run summary.
6. **Voidmaw event, Ranks board.** Run the event and open Ranks during it, then
   again after. A real pilot must not appear, vanish and reappear. In the
   console, `CLOUD.lbTop(100).then(r => r.filter(x => !x.power || x.power <= 0))`
   should come back empty — any row with zero power is an invisible pilot.
7. **Void anomaly banner fires ONCE per run.** Sit through a full run and watch
   for a repeat at the 6–9 second mark. One banner, then silence.
8. **Regression sweep on the v219 payload**, which players are seeing for the
   first time: Ranks → NANOCORE tab exists and the nine chips wrap without
   sideways scroll at 360px; Haulage ladder shows non-zero for pilots who have
   delivered; no broken-image box in any leaderboard row's fleet strip; the
   monthly mission board has no absurd target (tiles cap at **150**, core
   upgrades at **14**, and an already-issued board is re-clamped on load); and
   the first cargo run of a **hard-reloaded** session holds frame rate.
9. **Discord within ~2 minutes** — the first tick after deploy must post
   **nothing** about Nanocores or cargo. That silence is the backfill guard.
10. **Save merge across two devices.** Log in on a second device, ascend on the
    first, then reload the second. Ascension zeroes gold and level, so this is
    the case `saveWeight()` has to get right — Pilot Ascension stars stay the
    dominant weight term and the first merge tiebreak. The post-ascension save
    must win.

---

## What shipped in build 574 — FrostSkull's report

- **Badge chains scored a stock hangar as zero.** `shipLevels` only gains an
  entry once a hull has actually been UPGRADED, but every hull is Lv 1 the moment
  it is in the hangar. Summing that map alone meant a hangar full of Lv 1 ships
  counted for nothing on the Fleet Admiral chain — the "doesn't count lvl1 ships"
  report. `hullLevelSum()` now walks `ownedShips` as well and floors every owned
  hull at one level, de-duplicating against `shipLevels` so an upgraded hull is
  not counted twice.
- **Mob level ceiling of 999 removed.** The cap was applied in two places that
  had to be fixed together — the card display and the zone launcher — so a pilot
  past 999 saw a level that was not the one being fought. Zone selection now goes
  through `C.zoneCap` in every launcher path (`startDreadHunt`,
  `startServerDread`, `startAllianceRaid`) instead of a hard-coded `999`.
- **Cargo clock corrected.** Same class of bug as 571's speed-change drift,
  in the remaining path that had not been re-seeded.
- **Loot counters agreed with the run.** The counter and the summary were reading
  different sources; they now read one.
- **Leaderboard drop-outs during the Voidmaw event.** The 573 fix kept the last
  good power and refused to publish a zero, but the event has its own state
  rebuild that could still produce a publish with nothing behind it. Covered by
  the same guard.
- **Void anomaly banner re-fired every 6–9 seconds.** It was keyed to a condition
  that stayed true for the length of the run rather than to the event, so it
  re-announced on every poll. Fires once per run now.

Kept at 574 deliberately — the banner fix landed in the same build rather than
taking a version of its own, so the four stamps and the seven `?v=574`
references all describe one payload.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` cron succeeded at 00:05; watch sim-held territory.

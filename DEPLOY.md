# Loot Fleet — deploy v217 · build 562

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v216. Service worker cache is `lootfleet-v562`.

**Headline:** Space Cargo Defense (the escort event) + the Eternum, the smooth
flight model, the end-of-run frame-rate fix, the Ranks screen crash fix, and
the seven-ladder Ranks board with the new HAULAGE ladder.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 562 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `562` |
| Update beacon | `version.json` → `build` | `562` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v562` |
| Project root beacon | root `version.json` (source tree) | `562` |

```bash
grep -o 'LF_BUILD = [0-9]*' game.html; cat version.json; grep -o "lootfleet-v[0-9]*" sw.js
```

Root `sw.js` is NOT a stamp — it is the kill-switch worker for the old poisoned
origin and stays un-versioned. This folder's `sw.js` is the real one.

### Folder audit — run before the push (all green for this folder)

| check | result |
|---|---|
| js/css files `game.html` references | **71** |
| stale vs project root | **0** |
| missing from folder | **0** |
| references without `?v=` | **0** |
| root `game.html` vs folder copy | **byte-identical** |
| sw precache entries | **80**, none dead |
| referenced but not precached | **0** (9 offline gaps closed this release) |
| top-level html/json/js vs source | **identical** |

Nine files were referenced by `game.html` but had never been precached —
`ember-choir.css`, `hangar-ships.css`, `return-brief.js`, `rank-rewards.js`,
`discord-reward.js`, `onboard.js`, `pro-offer.js`, `paragon-cannon.js`,
`casino-citadels.js`. Offline, those screens fell through to a network fetch
that could not resolve. Added to `CORE`.

---

## Step 1 — run the SQL (REQUIRED — the HAULAGE ladder is empty without it)

Supabase → **SQL Editor** → paste **`supabase/cargo-ladder.sql`** → Run.

It adds the `cargo` / `cargo_best` columns to `leaderboard` and lets the
heartbeat publish them. Until it runs, real players publish nothing for the
HAULAGE board and the ladder shows sims only.

Verify:

```sql
select column_name from information_schema.columns
 where table_name = 'leaderboard' and column_name in ('cargo','cargo_best');
```

Two rows = done.

## Step 2 — redeploy the Discord Edge Function (if not already on ver 216+)

Supabase → **Edge Functions** → **discord-feed** → **Code** → select-all,
delete, paste **`supabase/functions/discord-feed/index.ts`** → **Deploy** and
wait for the confirmation.

Verify the running build stamps its version:

```sql
select status, content from net._http_response order by created desc limit 3;
```

Must show `"ver":216` or higher — no `ver` field means the old build is still
running (that is how the first attempt silently failed).

## Step 3 — push the site

Folder contents to the repo root, commit, let Vercel build. **The site goes
first, the beacon confirms after** — `version.json` in this folder already says
562, and the in-session update gate evicts every connected player onto the new
build within ~90 seconds of Vercel serving it. Never push a beacon bump without
the files it names.

## Step 4 — hard-reload and smoke-test

`Cmd/Ctrl + Shift + R`, then:

1. **Ranks** — open Command ▸ Ranks: all seven tabs render rows (the v216 code
   threw `ReferenceError: q is not defined` on every board; blank Ranks =
   stale js/ranks-boards.js).
2. **HAULAGE tab** — after Step 1, your own row shows your cargo wins; other
   real players fill in as their heartbeats publish.
3. **Cargo Defense** — fly a run; the citadel approach (last minute) should
   hold frame rate now. If it still stutters, read
   `localStorage.lf_play` right after — the new `cg:{r,v,e}` field counts live
   rings/voids/hostiles for diagnosis.
4. **Cargo missions** — Missions board shows the cargo chain (queued from the
   previous session, first real-host check).
5. Console shows `BUILD 562` on the login screen.

---

## What shipped since v216 (builds 502–562)

- **Space Cargo Defense** — five shipment tiers (Cargo I–Omega V), sector
  bosses, corridor-wide collapse rings, a 10-minute manual escort, upgrade-strip
  death penalty, integrity-scaled payouts, 2 runs/day (+Pro extras). The
  Eternum — Celestial Class freighter behind 1,000 missions · ★100 · Titan Sina.
- **Flight model rewrite** — velocity steering (no teleport-turns), committed
  autopilot targets, 620px proportional loot magnet.
- **Drone flights** — visual squadrons at 10:1–25:1 with lane offsets; cached
  gradients, no per-drone shadow blur.
- **Perf pass** — in-place array compaction, batched composite modes, gradient
  caches, squared-distance rejects, near-linear enemy separation.
- **End-of-run frame fix (562)** — collapse rings + void discs are pre-baked
  sprites (drawImage, not per-frame path fills), corridor rails/centre-lines
  clamp to the viewport, live voids capped at 12, `lf_play` sample now carries
  `cg` counts.
- **Ranks crash fix (562)** — `derive()` wrote sim haulage stats to an
  undefined `q`; every board threw and the screen rendered blank.
- **Seven-ladder Ranks** incl. HAULAGE (needs Step 1), publishing via the
  existing heartbeat.
- **Ascension pill (561)** — mobile shows one chip + bar; desktop unchanged.
- Pilot Tree bonuses survive ascension (`ASC_KEEP`), bonus cache re-validates
  on save merge, Skills page shows the active tree.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` cron succeeded at 00:05; watch sim-held territory.

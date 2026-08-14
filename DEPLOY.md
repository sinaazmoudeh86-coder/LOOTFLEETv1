# Loot Fleet — deploy v227 · build 583 · COMBAT LOCK-UP FIXES

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v226. Service worker cache is `lootfleet-v583`.
**Login screen reads `BUILD 583`.**

A plain bug-fix release — no data migration, no SQL, no reset. Four fixes, all
from the Aug 13 field reports: the stuck ship in boss zones, the Void Citadel
that could be pushed out of the arena, owned Dread hulls reading as unowned in
Nanocores, and the resource row stacking onto two lines.

Carries build 583 only. If v226 never went live, read that folder's DEPLOY.md
first — this folder contains its season-reset code too, and **its SQL sequence
still applies.**

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 583 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `583` |
| Update beacon | `version.json` → `build` | `583` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v583` |
| Project root beacon | root `version.json` (source tree) | `583` |

Root `sw.js` is NOT a stamp — it is the kill-switch worker for the old poisoned
origin and stays un-versioned. Verified un-versioned at cut time.

### Folder audit — all green

| check | result |
|---|---|
| js/css files `game.html` references | **74** |
| stale vs project root | **0** |
| missing from folder | **0** |
| references without `?v=` | **0** |
| references carrying `?v=583` | **5** (`web-v89.css`, `readability.css`, `entities.js`, `game-v93.js`, `ui-v94.js`) |
| `game.html` byte-identical to project root | **yes** |

Seeded from `deploy-v226`, then `js/`, `css/`, `guides/` and `supabase/` deleted
and re-copied from the project root as separate calls (never a bulk copy over
patched files — the v216 failure), then all 74 referenced files byte-compared.

Files changed: `js/game-v93.js`, `js/entities.js`, `js/ui-v94.js`,
`css/web-v89.css`, `css/readability.css`.

---

## THE SEQUENCE

1. **Push this folder** to the repo root and let Vercel build.
2. **Then** confirm `version.json` reads 583 at the live URL.

The beacon ships inside the folder, so the order is automatic — but if you push
the beacon by hand ahead of the files, connected players are evicted onto code
that is not live yet. Don't.

The update gate evicts every connected player within ~90 seconds of the push.

---

## What changed

### 1 · Ship frozen in boss zones — auto AND manual (the big one)

Two separate faults stacked into one symptom.

**The joystick was hidden while the game forced manual flight.** The stick is
only shown when `getAuto()` is false, and that check ran from `UI.syncAuto()`,
which was never exported on `window.UI`. The Voidmaw, alliance raids and the
cargo escort all call `setAuto(false)` directly to enforce manual flight — so
they flipped the mode and left the control surface hidden. No stick, no autopilot:
the ship did not move on either setting. It cleared itself as soon as anything
else happened to call `syncAuto()`, which is the reported intermittency ("every
3–4 times you jump into a boss dungeon it locks in"). `setAuto()` now notifies
the UI on every change.

**The autopilot could chase a target it was physically unable to reach.** The
player hull is clamped to the arena every frame; enemies were not. Given a
hostile outside those bounds the autopilot flew into the wall and held there at
full throttle — visually dead still. It now ignores any target outside the world.

### 2 · The Void Citadel could be pushed off the map

`Enemy.update()`'s station-keeping term was pure geometry with no reference to
the hull's own `speed`, so a `speed:0` hull still got a real push out of its
hold ring. The Void Citadel is exactly that hull. Closing inside its ring shoved
the fortress backwards, the autopilot chased it, and the pair walked each other
clean out of the zone — where a siege objective is unkillable and the zone can
never be completed.

Station-keeping is now capped by the hull's own speed, so a fortress genuinely
cannot move. **And enemies are clamped to the arena** — they were the only mover
in the game without a world clamp, which is what let this become unrecoverable
rather than merely annoying.

### 3 · Owned Dread hulls read as unowned in Nanocores

`shipUnlocked()` answers "can progress reach this hull?" — Nanocores was using it
as "do I own this hull?". Dread Harbinger, Tyrant and Omega gate on level
160/180/200, all **above the 150 level cap**, so after the season reset every
Dread hull a player owned disappeared from the MY HULLS filter. Award-only hulls
(Voidmaw, Eternum) returned false by design and had the same problem.

Ownership is checked first now. The buy path is unaffected — `shipBuyState()`
already returns `owned` before it ever consults this.

This is also the most likely source of the Dread-screen crash in the same report,
which was intermittent and not reproducible on demand. If it recurs, the console
line at the moment it happens will pin it.

### 4 · The resource row stacked onto two lines

The top-bar fit guard had four stages: three that compressed the chips and a
final one that wrapped to a second row. It now measures the overflow and scales
the whole row by that ratio instead, and wrapping is disabled outright so no
stage can start a second row. One row at every viewport width.

---

## Smoke-test after the push

1. Login screen reads **BUILD 583**.
2. Enter a Citadel Siege zone (any zone ending in 7). Fly straight into the
   Citadel and hold there — it must not slide backwards, and must stay on screen.
3. Jump in and out of a boss dungeon 5–6 times. The ship moves every time, on
   auto and on manual.
4. Start a Voidmaw run: auto turns off (by design) **and the joystick appears.**
   Same for an alliance raid and a cargo escort.
5. End a Voidmaw run — auto comes back on and the stick hides.
6. Nanocores → MY HULLS: every Dread-class hull you own is listed.
7. Open the Dread hull detail from the ships screen — no crash.
8. Top bar at 360px wide with large balances: one row, nothing clipped, nothing
   stacked. Rotate to landscape and back.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- **Solo-boss DPS display overstates damage** — `theoryDps` counts multishot,
  which needs a second target.
- **No recovery path for already-nulled gold balances** from the pre-578 bug.
- **The Dreadnaught and Voidmaw lost the 12× XP bonus** with all other bosses
  (579). Decide whether they deserve a carve-out.
- **The map will not stay empty** — `galaxyTick()` seeds simulated rival holdings
  again as people play. Expected, but worth knowing.
- **Simulated pilots were not reset** — `sim_pilots` still carries pre-reset
  levels and stars on the boards. Cosmetic; the SQL to pull them in line is in
  chat history.

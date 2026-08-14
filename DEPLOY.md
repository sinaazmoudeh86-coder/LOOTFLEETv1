# Loot Fleet — deploy v226 · build 582 · SEASON RESET

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v225. Service worker cache is `lootfleet-v582`.
**Login screen reads `BUILD 582`.**

**This release wipes player progress on purpose.** Pilot Ascension and the whole
galaxy map are cleared for everyone. It has a server half that must be run in a
specific order — see `supabase/reset-territory.sql` and the sequence below.

Carries builds 574–582. If earlier folders never went live, this supersedes all
of them, including the Dread-class gold-loss fix.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 582 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `582` |
| Update beacon | `version.json` → `build` | `582` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v582` |
| Project root beacon | root `version.json` (source tree) | `582` |

Root `sw.js` is NOT a stamp — it is the kill-switch worker for the old poisoned
origin and stays un-versioned. Verified un-versioned at cut time.

### Folder audit — all green

| check | result |
|---|---|
| js/css files `game.html` references | **74** |
| stale vs project root | **0** |
| missing from folder | **0** |
| references without `?v=` | **0** |
| references carrying `?v=582` | **2** (`game-v93.js`, `account.js`) |
| parse check on changed files | **clean** |

Seeded from `deploy-v225`, then `js/`, `css/`, `guides/` and `supabase/` deleted
and re-copied from the project root as separate calls (never a bulk copy over
patched files — the v216 failure), then every referenced file byte-compared.

Files changed: `js/game-v93.js`, `js/account.js`, plus the new
`supabase/reset-territory.sql`.

---

## THE SEQUENCE — do not reorder

1. **Announce it.** Players should not log in cold to a level-150 pilot on an
   empty map.
2. **Supabase → SQL Editor → run `supabase/reset-territory.sql`.** It archives
   the table to `territory_prereset_s1` first, then clears it.
3. **Push this folder** to the repo root and let Vercel build. The update gate
   evicts every connected player within ~90 seconds.
4. **Wait 10 minutes.**
5. **Run STEP 1 of the SQL again** (`delete from public.territory;`).

Step 5 is not optional. Between the first delete and the eviction, clients still
on the old build hold a populated `ownedSystems` and republish it into the empty
table. The second delete clears that. By then every client has wiped its local
mirror and latched `_turfRepub2`, which permanently retires the republish path —
so the table stays empty until someone captures fresh ground.

Running the delete once, before the push, and never again is the one sequence
that silently fails: the map looks reset for a minute and then comes back.

---

## What the reset does

### Cleared for every pilot

- **Pilot Ascension** — stars, points (spent and unspent), every perk rank.
- **Level clamped to 150** (the cap at zero stars), XP zeroed. Skill tree wiped
  and refunded to 149 points to respend inside the smaller budget.
- **The entire galaxy** — tiles, Void spires, House Citadel holds, player-built
  citadels and their levels, contest cooldowns, razed-citadel records, and the
  simulated rival owners. The map returns fully neutral.
- **Casino** — chips, bet size, win/loss books.

### Kept, verified

Gold, LootCoins, Dread Cores, Fuel, Ore, Plasma, Prism. Every item equipped, in
the hold, and in saved loadouts. Every hull, hull upgrade level and blueprint.
**Ship Ascension.** Starforge tempers. Nanocores. Moon Colony. Home Citadel
waves, structures and towers. Badges, lifetime stats, missions. VIP and Pro.
**Event and premium hull entitlements** — carried across the reset by name in
the merge, because some were bought with real money.

### Why it sticks

Every rule in `account.js` exists to stop ascension progress from regressing —
stars outrank weight and timestamps, and stars/points/perks are max-unioned. A
plain wipe would be repaired away at the next login on any device. `pasc.epoch`
is now compared **above stars** in `saveWeight()` and in all three merge paths,
so a reset save reads as the later timeline instead of a corrupted one. It also
re-bases the best-ever vault, or Save Recovery would keep offering the pre-reset
copy as the heaviest ever and players could restore their stars in one tap.

### Rollback

**There isn't one.** Once a client reaches epoch 1 and pushes, the pre-reset
cloud copy is permanently outranked by design. Each save records a full
`pasc.preReset` snapshot (stars, points, perks, level, XP, skills, skill points,
tile list, citadels) so a future epoch 2 could restore an individual account on
request. The server table is archived to `territory_prereset_s1`. Neither is
automatic; both are there so a support case is answerable.

---

## Smoke-test after the push

1. Login screen reads **BUILD 582**.
2. Ascension screen: 0 stars, 0 points, no perk ranks.
3. A previously-deep pilot is level 150 with 149 skill points to spend.
4. Galaxy map is empty — no owned tiles, no rivals, no citadels, no Void holds.
5. `select count(*) from public.territory;` returns **0** and stays there.
6. Hangar is intact: all hulls, all gear, all currencies, Ship Ascension intact.
7. Event/premium hulls still owned.
8. Log in on a second device — the reset holds, nothing comes back.

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

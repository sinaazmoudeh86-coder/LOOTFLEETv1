# Loot Fleet — deploy v223 · build 577

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v222. Service worker cache is `lootfleet-v577`.
**Login screen reads `BUILD 577`.**

**Headline:** two balance tickets from Rick C. Home Citadel costs no longer run
to hundreds of trillions, and levelling no longer accelerates as you climb.

Both reports were right about the symptom and slightly off about the cause,
which matters because the real causes were worse:

- **Citadel:** player level was never in the formula — but *hourly production*
  was, which is wave × zone depth × VIP × Mining Array level. That went in 576.
  What remained was `base × 1.9^structureLevel`, and against a 60-level ceiling
  `1200 iron × 1.9^41` **is 388 trillion** — Rick's exact number.
- **XP:** the Beacon is the trigger, not the disease. Per-kill XP was a fixed
  fraction of `xpToNext(level)`, so a level always cost the same 18,000 kills
  and the century steepening in the XP curve was cancelled before it reached a
  player. Kill rate climbs with power, so levelling genuinely got faster the
  further you went.

This folder also carries **v222 (576)**, **v221 (575)** and **v220 (574)** in
full. If any never went live, their `DEPLOY.md` smoke-tests still apply.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 577 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `577` |
| Update beacon | `version.json` → `build` | `577` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v577` |
| Project root beacon | root `version.json` (source tree) | `577` |

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
| references carrying `?v=577` | **2** (`game-v93.js`, `home-citadel.js`) |
| parse check on every file touched this cycle | **5 / 5 clean** |

Folder was seeded from `deploy-v222`, then `js/`, `css/`, `guides/` and
`supabase/` were **deleted and re-copied from the project root as separate
calls** — never a bulk copy over patched files (the v216 failure). Every
referenced `js`/`css` file was then byte-compared against the project root.

Files changed this build: `js/game-v93.js`, `js/home-citadel.js`.

---

## ⚠ READ BEFORE PUSHING — this build changes live economies

Neither change is retroactive and neither touches a save, but both change what
existing players are quoted and how fast they level. Nobody loses anything:

- **Citadel prices only go DOWN.** Every structure and tower level costs less
  than it did, at every level. No player is newly unable to afford something.
- **Scrap refunds are already capped** (576) at today's ladder price, so the
  cheaper ladder cannot be arbitraged against old spend.
- **Levelling slows above ~L20** and is unchanged below it. No XP is removed and
  no level is revoked — `xpToNext` itself is untouched; only the number of kills
  a level costs has changed.
- **Beacon still pays full gold, salvage and loot.** Only its XP is reduced.

Tell the Discord before pushing. A pilot who was mid-grind toward a level will
notice it taking longer, and that is the intended change, not a regression.

---

## Step 1 — SQL (only if these have never been run)

Supabase → SQL Editor. Both are safe to re-run and neither is new:

- `supabase/nanocore-ladder.sql` — Nanocore ladder.
- `supabase/cargo-ladder.sql` — Haulage ladder.

Nothing in build 577 needs a migration.

## Step 2 — Discord feed Edge Function (only if v219 was never deployed)

```bash
supabase functions deploy discord-feed
```

Cron log `"ver"` must read `570` or higher:

```sql
select content from net._http_response order by created desc limit 3;
```

## Step 3 — push the site

Folder contents to the repo root, commit, let Vercel build. **The site goes
first, the beacon confirms after** — `version.json` in this folder says 577 and
the in-session update gate evicts every connected player onto the new build
within ~90 seconds of Vercel serving it. Never push a beacon bump ahead of the
files it names.

## Step 4 — hard-reload and smoke-test

`Cmd/Ctrl + Shift + R`, then:

1. **Login screen shows `BUILD 577`.**
2. **No Citadel price reads in the trillions below Lv 55.** This is Rick's
   ticket. On a deep account, open the Citadel and read the Mining Array:
   Lv 30 should be about **163M gold / 7.8M iron**, Lv 40 about **3.0B / 146M**.
   If anything asks for hundreds of trillions, the file did not deploy.
3. **Prices are identical on two accounts at different waves** (the 576 change,
   still true).
4. **A Mining Array level does not raise any other price.**
5. **Press Beacon at a high level.** The XP bar must move a *fraction* of a
   level, never multiple levels. Half a level is the hard ceiling per swarm
   whatever the perk stack.
6. **Beacon gold and loot are unchanged.** Only XP was reduced — if gold per
   swarm dropped, that is a bug.
7. **Low-level levelling feels the same.** Below about L20 the kills-per-level
   term is ~1.0 and nothing should have changed. Check a fresh account.
8. **Regression sweep on 576/575/574** if any never shipped — Citadel fixed
   pricing, hold count after Sell on Pickup, drone count matching the bay, badge
   hull levels, the 999 mob cap, cargo clock, Voidmaw leaderboard drop-outs.

---

## What shipped in build 577

### Ticket 1 — Home Citadel cost curve

Structure growth **1.9 → 1.34**, tower growth **1.55 → 1.30**. Bases and the
Citadel ascend ladder (`2M × 3^lv`) are unchanged.

| Mining Array | Lv 10 | Lv 20 | Lv 30 | Lv 40 | Lv 50 | Lv 60 |
|---|---|---|---|---|---|---|
| gold | 467k | 8.7M | 163M | 3.0B | 57B | 1.06T |
| iron | 22k | 418k | 7.8M | 146M | 2.7B | 51B |

Thousands to millions early, millions to billions mid, billions late, trillions
only at Lv 60 — which requires Citadel 5. The most expensive purchase in the
game is now the final Annihilator Rail level at **4.2T**, down from
quintillions. Rick's benchmark (a trillion of a resource should be a month-plus
of accumulation) is what the top of the ladder is set against.

### Ticket 2 — XP progression and Beacon

- **Kills per level now grows with level.** `xpKillsPerLevel(level) =
  18000 × (1 + level/150)^1.4` replaces a hardcoded 18,000. Result: **18k at L1,
  27k at L50, 37k at L100, 59k at L200, 84k at L300, 140k at L500.** Below ~L20
  the term is ~1.0, so the early game is untouched. `xpToNext()` in
  `config-v2.js` is NOT modified — it was already steep; it was being cancelled
  downstream, which is why the steepening never showed up in play.
- **The tithe no longer pays full XP.** Wreckfield Tithe stacks to several × and
  every beacon-summoned enemy carries it, so a swarm paid its entire kill count
  at multiplied XP. Gold, salvage and loot keep the whole tithe; XP takes a
  quarter of it (`1 + (tithe − 1) × 0.25`).
- **Hard ceiling of half a level per beacon window,** set from
  `xpToNext(currentLevel)` when the beacon fires and spent down by beacon kills
  — the reinforcement trickle draws on the same budget. Whatever the stack, one
  press can never be a level button.

Measured at 9,000 kills per swarm with a ×6 tithe: **0.50 levels at L100
(hitting the cap), 0.24 at L300, 0.14 at L500** — two to seven beacons per
level, and sloping the right way for the first time.

### Left alone deliberately

- **`xpToNext()` and the level 500 cap.** Rick noted 500 was picked because it
  felt right rather than derived. The curve itself was not the problem, so it
  is untouched pending a decision on where the cap should actually sit.
- **Emergency Citadel repair still scales with production** — a per-incident
  service fee, not an upgrade.
- **Tower damage still scales off fleet DPS**, so a tower bought late is worth
  more than the same tower bought early. That is now the only way progression
  enters tower value.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` cron succeeded at 00:05; watch sim-held territory.
- **Solo-boss DPS display overstates damage.** `theoryDps` counts multishot, but
  multishot needs a second target — the number shown in a Voidmaw or Dread fight
  is higher than what you actually do. Balance question, unresolved.

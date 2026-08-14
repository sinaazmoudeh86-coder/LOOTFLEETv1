# Loot Fleet — deploy v225 · build 579

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v224. Service worker cache is `lootfleet-v579`.
**Login screen reads `BUILD 579`.**

**Headline:** boss kills no longer pay an XP bonus. Boss dungeons were the
fastest XP in the game — a repeatable boss paid **12× XP** on a fight you can
queue back to back, which is a farm rather than an encounter.

This folder carries **578, 577, 576, 575 and 574** in full — including the
Dread-class gold-loss fix. If v224 never went live, push this instead; it
supersedes it and its `DEPLOY.md` smoke-tests still apply.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 579 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `579` |
| Update beacon | `version.json` → `build` | `579` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v579` |
| Project root beacon | root `version.json` (source tree) | `579` |

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
| references carrying `?v=579` | **1** (`game-v93.js`) |
| parse check | **clean** |

Folder was seeded from `deploy-v224`, then `js/`, `css/`, `guides/` and
`supabase/` were **deleted and re-copied from the project root as separate
calls** — never a bulk copy over patched files (the v216 failure). Every
referenced `js`/`css` file was then byte-compared against the project root.

Files changed this build: `js/game-v93.js`.

---

## ⚠ STILL CARRYING THE MONEY-LOSS FIX

If v224 was never pushed, everything in its warning still applies: players are
losing balances to the Dread-class partial charge right now, and this folder is
the fix. Recovery is not possible for already-corrupted saves — a nulled balance
never had its real value written anywhere. Do not restore currency from
`lf-best` or `lf-backup`; those snapshots predate resets.

---

## Step 1 — SQL (only if these have never been run)

`supabase/nanocore-ladder.sql`, `supabase/cargo-ladder.sql`. Both safe to
re-run, neither is new. Nothing in 579 needs a migration.

## Step 2 — Discord feed Edge Function (only if v219 was never deployed)

```bash
supabase functions deploy discord-feed
```

Cron log `"ver"` must read `570` or higher.

## Step 3 — push the site

Folder contents to the repo root, commit, let Vercel build. **The site goes
first, the beacon confirms after** — `version.json` here says 579 and the update
gate evicts every connected player within ~90 seconds of Vercel serving it.

## Step 4 — hard-reload and smoke-test

`Cmd/Ctrl + Shift + R`, then:

1. **Login screen shows `BUILD 579`.**
2. **Kill a zone boss and watch the XP bar.** It must move by roughly what a
   normal kill in that zone gives — not twelve times it.
3. **Boss GOLD is unchanged.** Same kill should still pay a boss-sized gold
   number. If gold dropped too, that is a bug — only XP was cut.
4. **Boss loot and drops are unchanged.**
5. **Check the Dreadnaught and Voidmaw.** These run through the same `isBoss`
   path, so they lost the bonus as well. If either is meant to stay a real XP
   event, it needs an explicit carve-out — decide before or shortly after this
   ships.
6. **Regression:** the ships screen scrolls past Dread without crashing, and a
   Dread purchase either charges and grants or does neither (v224 fixes, first
   live here if v224 was skipped).

---

## What shipped in build 579

- **Boss XP bonus removed.** The `× 12` on `e.isBoss` is gone from the XP award.
  A boss now pays exactly what any kill in that zone pays. Boss dungeons were
  the fastest levelling route in the game by a wide margin, and the repeatable
  ones made it a loop rather than an event.
- **Gold, loot and drops keep the full 12×.** Killing a boss is still worth a
  boss's reward — it just is not levels. Only the XP line changed; the gold line
  is untouched and was verified to still carry the multiplier.

### Known knock-on — needs a decision

The Dreadnaught hunt and the Voidmaw event resolve through the same `isBoss`
flag, so they lost the 12× as well. That may be correct (they are the biggest
XP farms of all) or it may be too blunt (they are genuine encounters, not a
loop). Nothing was carved out; flagging it rather than guessing.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` cron succeeded at 00:05; watch sim-held territory.
- **Solo-boss DPS display overstates damage** — `theoryDps` counts multishot,
  which needs a second target.
- **No recovery path for already-nulled balances.** If this hit many players,
  the honest options are a manual grant or a documented amnesty.

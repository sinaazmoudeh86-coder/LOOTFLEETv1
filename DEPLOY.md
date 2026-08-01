# LOOT FLEET V3.0 BETA — Deploy v204 (build 408 · SW cache `lootfleet-v408`)

Push this folder to GitHub → Vercel. **Save-integrity + Ranks release.**
Client-only: **no SQL to run.** Every change is in `js/` + `game.html`.

## Database

**Nothing to run.** No schema, function or policy changed in this release.
v203's list (`social.sql`, `alliance-boss-onekill.sql`, `lb-upsert-canonical.sql`,
`sim-kills-sanity.sql`, `lb-asc-sync.sql`) still applies to a *fresh* environment
and is already live in production — the `supabase/` folder is carried unchanged
so a new environment can still be built from this folder alone.

## Files changed since v203

| File | Why |
|---|---|
| `js/game-v93.js` | Retired the destructive rescale migration + added the gear/gold repair pass |
| `js/ui-v94.js` | Item sheet: one Equip button per hardpoint |
| `js/sim-pilots.js` | Fixed cohort clock + board injection |
| `js/leaderboard.js` | Removed dead roster generators |
| `js/pilot-ascension.js` | CTA moved to top; ascension keeps hull levels + Ship Ascensions |
| `css/pilot-ascension.css` | Styles for the new CTA block |
| `game.html` | Command-menu close button, hardpoint styles, ascension copy, build 408 |

---

## What shipped in this release

### ⚠ SAVE CORRUPTION — gear and gold wiped on every login
The headline fix. Players at deep zones reported dropping from **billions of
power to thousands** on login, with every item showing `+1 Damage / +1 Health`,
and their **gold reset to 0** — while percentage stats (crit, fire rate, move
speed) were untouched. Unequipping and re-equipping did nothing, because the
item data itself had been destroyed.

**Cause.** The one-time `scaleVer` migration that rebased saves from the old
1.55 power curve onto the 1.18 curve was still in the boot path, and it was
running **on every login instead of once**:

* It multiplied every flat stat, and all gold, by `ratio^(zone-1)` where
  `ratio = 1.18/1.55`. At zone 109 that factor is ~`1.5e-13`. A billion-point
  stat floored straight through `Math.max(1, …)` to **1**, and gold floored to
  **0**. It also zeroed `state.xp`.
* Only zone-scaled flat stats ride that curve, so percent stats were left alone
  — exactly the signature players described.
* It re-ran because the crushed save was often refused by the cloud clobber
  guard, so the server kept handing back the un-stamped copy, which was then
  crushed again on the next login. An endless loop.

**Fix.** The migration is deleted, not gated. Saves are stamped `scaleVer = 3`
and left untouched. Two repair passes run once on load:

* **Gear** — any flat stat below **2%** of what the item's own zone + rarity can
  physically roll (the generator floor is 0.82× base) is rebuilt from that
  formula at 0.9× base. Idempotent, and healthy gear can never trip it.
* **Gold** — restored from the strongest surviving local snapshot
  (`lf-best::` / `lf-backup::`), whichever is higher than the current balance.

A toast reports what was recovered. Damage that already reached the cloud is
rebuilt from the item's zone/rarity, so restored rolls are close but not
byte-identical to the original.

### Ranks showed a different number of players on every device
One browser showed **15** pilots, another **28**, and clearing site data shrank
the board again. Two independent faults:

* **The roster clock was per-device.** Simulated pilots "join" at ~1.5/hour
  measured from a `lf-sim-epoch` timestamp written to `localStorage` on first
  run — so the roster's age, and therefore its size, was a property of *that
  browser's install date*. Now anchored to a fixed launch date
  (`COHORT_EPOCH`), so every device and account sees the same roster.
* **The top-10 seat cap ate the board.** Under a pure power sort, skipping a
  sim leaves its rank open — so the next sim lands on the *same* rank and is
  skipped too, cascading down the entire roster. With one human and a strong
  roster it admitted exactly **2** rows. The cap is removed client-side;
  `sim_board()` already applies `max_top10` / `allow_rank1` server-side before
  rows reach the client.
* Also fixed: `forBoard()` returned **live references** into the cached roster,
  so the Heat and All-Time boards stamped `rank` onto the same objects and
  corrupted each other's ordering. It now returns copies.

`forBoard()` went from ~40 lines of O(n²) rank recomputation to 4 lines. The
board now renders a full **60 rows**, identically everywhere.

### Could not equip into the 3rd, 4th … hardpoint
The item sheet only ever offered **Equip** and **Equip 2nd**, so on hulls with
3–7 mounts of a type (Dreadnought, Titan, Mothership, Oblivion, Voidmaw, every
Dread-class) the extra slots were unreachable from the UI — only auto-equip
could fill them. The sheet now renders **one button per hardpoint**, labelled
(`1st Cannon`, `2nd Cannon`, …) and showing what is currently mounted, with
empty mounts highlighted.

### Pilot Ascension — hull investment now survives
**Rule change.** Hull **upgrade levels** and each hull's **Ship Ascension**
(module tiers + stars) now carry across an ascension. They are shipyard work
done to the *ships*, not the pilot's run. What still resets: pilot level, all
items, gold and resources, Starforge tempers, the Pilot Tree, territory,
citadels and the wing.

Every surface was rewritten to match — the ascend CTA (now at the **top** of the
screen, directly under the hero, with a keep/lose summary), the itemised ledger,
the flagship picker, the two-step confirm, the acknowledgement checkbox, the
outro, and the Command-menu pill.

### Command menu
Added a close **✕** button to the sheet (top-right) and Escape-to-close. It
previously relied on tapping the backdrop, which is easy to miss on phones.

---

## Deploy steps

1. **No SQL.** Skip straight to the static push.
2. Push this folder to the repo root that Vercel serves.
3. Confirm `version.json` reads `{"build":408,"label":"V3.0 BETA"}`.
   The update gate locks out older clients, so publish the static files
   **before** (or with) this file — never ahead of them.
4. Hard-reload once so the `lootfleet-v408` service worker takes over.

## Post-deploy checklist

- [ ] Log in on a deep-zone account, then log out and back in **twice** — power
      and gold must be identical each time. This is the regression that matters.
- [ ] Open a high-zone item: Damage/Health read real numbers, not `+1`
- [ ] Ranks: **60 rows**, and the same count on two different devices/browsers
- [ ] Ranks: rank column reads 1…60 with no gaps or repeats after switching
      between the Heat and All-Time boards
- [ ] Equip a cannon into the **3rd** and **4th** hardpoint on a Dreadnought or
      better, from the item sheet
- [ ] Command menu: ✕ closes it; Escape closes it
- [ ] Pilot Ascension: BEGIN ASCENSION is visible without scrolling; ledger says
      hull levels and Ship Ascensions are **kept**
- [ ] Ascend a test account — hull upgrade levels and Ship Ascension stars are
      still on every hull afterwards

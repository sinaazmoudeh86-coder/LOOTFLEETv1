# Loot Fleet — deploy v257 · build 730 · AUTO-SELL

Push the **contents of this folder** to the repo root Vercel serves.

Supersedes **v256 (build 729), which is what players are running right now.**
Service worker cache is `lootfleet-v730`. **Login screen reads `BUILD 730`.**
The update gate force-reloads every live session within ~90s of the beacon.

> **One fix, and no server work.** No SQL, no Edge Function, no migration. 730
> changes two files and touches nothing that can reach a save.

---

## 1. NO SQL, NO EDGE FUNCTION

Nothing to run. All three of 729's outstanding server items were completed and
confirmed before that push: `global-chat.sql` (installed and `chat_post()`
smoke-tested), `temple-retire.sql` (run once), and the `discord-feed` redeploy at
`FEED_VER 727`.

**Do not re-run any of them as routine.** None touches `lb_upsert`, so none is
*dangerous* to repeat, but the standing hazard list is unchanged: re-running
`new-ladders.sql`, `cargo-ladder.sql`, `nanocore-ladder.sql` or
`discord-art-publish.sql` re-adds an older `lb_upsert` overload and requires
re-running `pilot-ladder.sql`.

**Do NOT run `supabase/temple.sql` — it no longer exists and must not be
recreated.**

---

## 2. PUSH THE SITE, `version.json` LAST

Never bump the beacon ahead of the files. `js/update-gate.js` polls
`version.json` every 90s and force-reloads any session where
`version.json build > LF_BUILD` — publish the beacon first and you evict every
player onto code that is not there yet.

---

## BUILD STAMPS

| stamp | value |
|---|---|
| root `game.html` `window.LF_BUILD` | 730 |
| root `version.json` | 730 |
| `deploy-v257/version.json` | 730 |
| `deploy-v257/sw.js` `CACHE` | `lootfleet-v730` |
| `discord-feed` `FEED_VER` | 727 (deployed — nothing to do) |

All four agree.

**Verified by script before handover:**

- All **97** `js`/`css` files `game.html` references diffed byte-for-byte against
  the project root — **zero stale, zero missing, every ref cache-busted**.
- Folder built by the procedure: `deploy-v256` copied first, then `js/`, `css/`,
  `guides/` and `supabase/` deleted and re-copied fresh from root as separate
  operations, then the html files. This is the v216 guard — a bulk copy in the
  same call as the patched directories is how v216 shipped v215 code stamped as a
  new build.
- `js/social-upload.js` **excluded** from this folder and confirmed not
  referenced by `game.html`. Local operator tool; reads a service key from
  localStorage; must never ship.
- root `sw.js` confirmed still **unversioned** — it is a deliberate kill-switch
  worker for an old poisoned origin and must never be given a `CACHE` version.
- `audit/` excluded (dev harnesses).

### Files at `?v=730` (changed this build)

```
js/game-v93.js       auto-sell: an unfitted hardpoint only reserves gear for a hull IN SERVICE
js/patch-notes.js    730 card — carries 729's rows (see below)
```

Everything else keeps its existing `?v=`, so a player on 729 re-fetches two
files and nothing more.

---

## THE PATCH CARD CARRIES 729's ROWS, DELIBERATELY

`js/patch-notes.js` shows exactly one card, keyed on `LF_BUILD` in localStorage.
729 shipped only hours before 730 was cut, so **most accounts had not logged into
729 yet.** Replacing its card with a 730-only card would mean anyone who missed
that login never sees any of those 24 rows — including the Home Citadel wave-pay
**nerf** and the ◇ Dread Core **scarcity pass**, both of which CLAUDE.md requires
be stated out loud or they read as bugs.

So the 730 card is the 729 card plus this build's change, folded into the row it
belongs to rather than repeated at the bottom. Once 730 has been live long enough
for the population to turn over, the next card may drop these rows.

---

## WHAT CHANGED SINCE 729

### Auto-sell clears a big hold again

The 727 pass replaced "every empty slot vetoes every item" with "every empty slot
reserves **one** item" — correct in shape, and still useless on a mature account.

`emptyHardpoints()` walked **every hull the account owns**, hangar included, and
every unfitted slot reserved one item from the sweep. Hulls ride through every
ascension and a parked hull's slots are never filled, so a large fleet meant
**hundreds of permanently reserved holes**: bounded in theory, indistinguishable
from "auto-sell does nothing" for exactly the players with enough ships to
notice. Reported against a 1.09T fleet score.

The fix is not to stop counting parked hulls — that protection is deliberate, and
it is what stops a Venom Lattice being sold because you happened to be flying a
Titan. Instead **a hole now knows whether its hull is in service:**

- **Flagship and the escorts actually flying** — holes behave exactly as before.
- **Parked hulls** — may only reserve an item that *nothing in service can mount
  at all*. That is precisely the hull-locked case (an Aegis projector while you
  fly something else) and nothing else.

Reserved holes drop from ~320 to ~40 on a 40-hull account, and stay at ~40
however many hulls are owned. Anything that beats a **fitted** item is still kept
unconditionally, as before.

`inServiceCanMount()` returns `true` on any thrown error. This path destroys
items, so every doubt keeps the gear.

**No save impact.** Nothing here writes to `state`, changes a stored shape, or
touches `ASC_KEEP` / `mergeSaves()` / `sanitizeSave()`.

---

## POST-PUSH CHECKS

1. **Login screen reads `BUILD 730`.** If it reads 729 the html did not land.
2. **A live session force-reloads within ~90s** of `version.json` going up.
3. **Auto-sell:** on an account with a full hold and several owned hulls, set
   *Sell on pickup* to a tier at or above the junk you are carrying. The hold
   should clear on the spot — `setAutoSellTier()` sweeps immediately rather than
   waiting for the next pickup.
4. **The Aegis case still holds:** own an Aegis hull, park it, fly something
   else, and confirm a field projector at or below the auto-sell tier is **not**
   sold. This is the regression to watch; everything else about the change only
   sells more.
5. **Patch card:** a player coming from 729 sees one card reading `BUILD 730`
   with the full row set. A player who never logged into 729 sees the same card —
   that is the point.

---

## ROLLBACK

Re-push the contents of `deploy-v256` (build 729) and set `version.json` back to
`{"build":729,"label":"V3.0 BETA"}`.

**Caveat: the update gate only forces players FORWARD** — it triggers on
`version.json build > LF_BUILD`. Sessions already on 730 stay on 730 until they
reload of their own accord. Rolling back the site does not recall them.

Nothing server-side to roll back, and nothing in this build can have altered a
save, so a rollback cannot cost player progress.

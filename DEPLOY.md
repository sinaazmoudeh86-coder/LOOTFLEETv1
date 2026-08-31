# Loot Fleet — deploy v259 · build 734 · PLAYER BUG PASS + COMMAND SECTIONS

Push the **contents of this folder** to the repo root Vercel serves.

Service worker cache is `lootfleet-v734`. **Login screen reads `BUILD 734`.**
The update gate force-reloads every live session within ~90s of the beacon.

> **`deploy-v256` / build 729 is STILL WHAT PLAYERS ARE RUNNING.** 730, 731, 732,
> 733 and 734 were each cut and verified without ever being pushed. This folder
> therefore carries **five builds** to the population at once, and its patch card
> carries all five builds' rows for that reason — see below.

> **Client-only.** No SQL, no Edge Function, no new save field, no migration.
> Nothing in 734 changes the shape of anything already stored.

**Superseded — do not push, and do not re-seed from root:** `deploy-v256` (729),
`deploy-v257` (730), `deploy-v258` (733). Root is 734.

---

## 1. NO SQL, NO EDGE FUNCTION

Nothing to run. All three of 729's server items were completed and confirmed
before that push: `global-chat.sql` (installed and `chat_post()` smoke-tested),
`temple-retire.sql` (run once), and the `discord-feed` redeploy at `FEED_VER 727`.

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
| root `game.html` `window.LF_BUILD` | 734 |
| root `version.json` | 734 |
| `deploy-v259/version.json` | 734 |
| `deploy-v259/sw.js` `CACHE` | `lootfleet-v734` |
| `discord-feed` `FEED_VER` | 727 (deployed — nothing to do) |

All four agree.

**Verified by script before handover:**

- All **101** `js`/`css` files `game.html` references diffed byte-for-byte
  against the project root — **101/101 identical, zero stale, zero missing,
  every ref cache-busted.**
- Every file whose content actually differs from `deploy-v258` (build 733) was
  checked against its `?v=` token: **10 changed, 10 bumped, none missed and none
  bumped needlessly.** `js/config-v2.js` did **not** change since 733 and
  correctly keeps `?v=733`.
- Folder seeded from `deploy-v258` **first**, then every referenced text file
  re-synced from root. That order is deliberate: the copy brings the art and the
  operator docs, the sync guarantees the code matches root.
- **Root `sw.js` was NOT copied.** Root's is the 945-byte self-retiring
  kill-switch for an old poisoned origin; this folder's is the real 9,116-byte
  caching worker, and only its `CACHE` token was stamped. Confirmed by size and
  by the presence of `caches.open` in the folder copy. A blind root→folder text
  sync replaces the worker with the kill-switch and every cached client
  unregisters itself.
- `js/social-upload.js` **excluded** and confirmed not referenced by `game.html`.
  Local operator tool; reads a service key from localStorage; must never ship.
- `audit/` excluded (dev harnesses).

### Files at `?v=734` (changed this build)

```
css/fx-aaa.css          disabled sheet-CTA / feed paint fixes
js/game-v93.js          Aegis auto-sell holes, rim-tile sealing, void spires vs citadels
js/ui-v94.js            Zone Grind paging, Pilot Tree chips, Command-adjacent UI
js/dreadnaught.js       dread core payout figures
js/ranks-boards.js      board fixes
js/mail.js              stale war-report suppression
js/cargo-defense.js     gold + dread core payout corrections
js/nanocores.js         crate price ×2 · legendary dupe 5:1 conversion
js/nanocores-ui.js      exchange row for the legendary trade
js/patch-notes.js       734 card — carries 730–733's rows (see below)
```

`game.html` also changed (Command sections; it is the page, so it carries no
`?v=` — the service worker's new `CACHE` token is what re-fetches it).

**A player on 733 re-fetches 10 files. A player on 729 — which is everyone —
re-fetches 18**, being everything whose token moved after 729.

---

## THE PATCH CARD CARRIES 730–733's ROWS, DELIBERATELY

`js/patch-notes.js` shows exactly one card, keyed on `LF_BUILD` in localStorage.
730, 731, 732 and 733 were each cut without being pushed, so **no live account
has ever seen any of their cards.** A 734-only card would mean the population
jumps 729 → 734 and never sees the Home Citadel wave-pay **nerf**, the ◇ Dread
Core **scarcity pass**, the contiguity bonus or the siege shield — and CLAUDE.md
requires a nerf be stated out loud or it reads as a bug.

Drop the older rows only once 734 has been live long enough for the population to
turn over.

---

## WHAT CHANGED SINCE 733

### The player bug pass

Nine reports, all client-side:

- **Stale war mail.** A report is only filed if it can be dated within 36h or was
  confirmed yours this session; the mailbox record itself blocks duplicates.
- **Zone Grind froze the tab.** The list drew every zone ever unlocked — ~750
  planets and labels rebuilt on each open. Now pages 120 rows at a time
  (330KB → 54KB per page) with your recommended and current zone always in view.
- **Aegis auto-sell.** Fitted Aegis mounts are treated as holes, so a parked hull
  can give up a worse item.
- **AUTO toggling back on.** The choice is session-only and cleared at boot.
- **Cargo Defense** gold and ◇ core payouts corrected; core figures are no longer
  scaled twice by the scarcity rate.
- **Rim tiles** acknowledge the map edge instead of asking you to fill borders
  that do not exist.
- **Void spires** no longer count toward the citadel total.
- **Legendary nanocore dupes** convert 5:1 into a Legendary for a hull you are
  missing.
- **Pilot Tree** ◇1 chips kept only on ◇3 nodes and the selected node.

### Nanocore Crates cost twice what they did

`CFG.crate` only: single `30,000 → 60,000`, ten `270,000 → 540,000`, list price
`300,000 → 600,000`. The 10% bundle discount is preserved. Balance lives in `CFG`
and the UI quotes it directly, so no screen restates the figure. **Nothing is
taken off an account** — a price rise cannot revoke a core or an ingot already
held.

### Command is grouped into six foldable sections

25 destinations in one flat grid was ~2.6 screens of scroll on a phone with every
card weighing the same. They now sit under **Live & Events · Empire · Power ·
Workshop · More**, each with a sticky header that rolls up the live badge count
of the cards beneath it.

**The 25 cards were not rewritten.** They keep their markup, ids, badge elements
and `[data-go]` handlers; the script only reorders the nodes and inserts headers,
so `sync()`, the beta gate, the star-locks, the lock chips and the click dispatch
are all the same code. Three CSS pins had to be released — `.cmd-sdread` and
`.cmd-galaxy` were nailed to `grid-row:1` and `.pa-pill` carries `order:-1`, and
visual order beats DOM order in a grid, so all three were escaping their group.

Also fixed in passing: `#mega-hint` (the "next system unlocks at Level N" line)
was being inserted as the first child of `#mega`, **before** `.mega-back`, which
is absolutely positioned over the whole inset — so it has been painting
underneath the backdrop. It now goes into the grid, which is what its
`grid-column:1/-1` was written for.

**No save footprint.** Fold state is a device fact in
`localStorage.lf_cmd_folded`, next to `lf_gc_open` and `lf_pltree_view`. Nothing
in `state`, no `saveWeight()` term, no `mergeSaves()` union block, nothing in
`ASC_KEEP`. Default is all-open, so an existing player sees the same 25 cards.

Harness: `audit/command-sections.html` (not shipped) drives the real `game.html`
in iframes at 360×640, 740×450 and 1100×700 — **48/48**, including "no card sits
above the first header", "no card escapes its group via order/grid-row" and
"nothing written into state".

---

## POST-PUSH CHECKS

1. **Login screen reads `BUILD 734`.** If it reads 729 the html did not land.
2. **A live session force-reloads within ~90s** of `version.json` going up.
3. **Command opens on five headers, all expanded**, with all 25 systems present
   and Pilot Ascension sitting inside **POWER** — not pinned to the top row. If
   it is at the top, `.pa-pill{order:-1}` is winning and the html is stale.
4. **Fold a header, reload.** It should still be folded, and its header should
   still show the count and any badge total from inside it.
5. **Nanocore crate reads ◈ 60,000 / ◈ 540,000** in Crates ▸ Nanocore Crate, and
   the "not enough ingots" copy quotes the same number.
6. **Patch card:** a player coming from 729 sees one card reading `BUILD 734`
   carrying every row from 730 through 734.

---

## ROLLBACK

Re-push the contents of `deploy-v256` (build 729 — the current live build) and
set `version.json` back to `{"build":729,"label":"V3.0 BETA"}`.

**Caveat: the update gate only forces players FORWARD** — it triggers on
`version.json build > LF_BUILD`. Sessions already on 734 stay on 734 until they
reload of their own accord. Rolling back the site does not recall them.

Nothing server-side to roll back, and nothing in this build changes the shape of
a save, so a rollback cannot cost player progress.

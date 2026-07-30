# LOOT FLEET V3.0 BETA — Deploy v203 (build 407 · SW cache `lootfleet-v407`)

Push this folder to GitHub → Vercel. **Stability + Hollow Armada release.**
Built fresh from the working tree — v202's folder was still a build-396 shell
with 406-era code mixed into it, so deploy this folder, not that one.

## Database — run in this order

| # | File | Gives you |
|---|---|---|
| 1 | `supabase/social.sql` | **RESTORED to the folder** — the entire alliance / friends / wallet schema (`alliance_state`, `alliance_join`, `social_wallet`, `friend_*`, …). It had fallen out of the deploy folder after v168; already live on the server, so this is a no-op re-run there, but a fresh environment cannot build without it |
| 2 | `supabase/alliance-boss-onekill.sql` | **NEW · REQUIRED** — must run **after** `social.sql`, which it supersedes: one kill per attack, anchor + clamp both ×50, `boss_max` only re-anchored on a kill, flat **⬡ 300** per kill to every member |
| 3 | `supabase/lb-upsert-canonical.sql` | From v202 — collapses the two `lb_upsert` overloads (ambiguous 6-arg calls published no leaderboard row at all) |
| 4 | `supabase/sim-kills-sanity.sql` | From v202 — caps simulated kill counts at a plausible career total |

Everything else (`pilot-ascension.sql`, `simulated-pilots*.sql`,
`sim-board-bignum-fix.sql`, `notifications.sql`, `territory*.sql`) is unchanged
and already run. All files are idempotent — safe to re-run.

`alliance-boss-balance.sql` from v200 is **dead** — do not run it; #2 replaces it.

---

## What shipped in this release

### The blank-screen bug — nine screens, one cause
Players reported the Starforge "sometimes loads nothing." The cause was a
temporal-dead-zone crash, and an audit found the identical pattern in **eight
more modules**: each called `boot()` from its module body while the `CSS` const
that `boot()` reads is declared at the *bottom* of the file. Whenever the script
finished parsing after `DOMContentLoaded` — cache miss, slow shell, restored tab,
a cold service-worker fetch — `boot()` threw a `ReferenceError` that aborted the
rest of the file, **including the `window.X = {…}` export at the end**. The
screen's tab then had nothing to call and painted an empty panel. Intermittent by
nature: on a warm cache the same code paths were fine.

Fixed in: `starforge.js`, `ascension.js`, `casino.js`, `casino2.js`,
`dreadnaught.js`, `galaxy-box.js`, `home-citadel.js`, `server-dreadnaught.js`,
`shipworks.js` — the boot call now runs at the very end of each file, past the
CSS literal. Starforge additionally boots its styles from `render()` and retries
a few frames if its panel markup isn't parsed yet.

**Watch for this shape in new modules:** a `const` at the bottom of the IIFE is
invisible to anything the module body executes above it.

### Hollow Armada — no more phantom marks
The raid showed a Voidmaw-style Mk ladder that only ever existed on the client:
its damage normalization guaranteed 2.4× the shared pool per run, and a local
loop minted Mk-2, Mk-3, … So players climbed to Mk-10 in the arena while the
server stayed on Mk-1, paid no ⬡, and still showed a full HP bar. Three separate
faults, all fixed:

* **Stages.** The client no longer advances marks at all. The arena hull **is**
  the shared pool — its bar mirrors pool-remaining — and the run ends the moment
  the pool hits 0. One Armada per attack; the mark advances only on server
  confirm.
* **No payout.** The pool anchored at `sum(power) × 200` while a single attack
  was clamped to `power × 25`, so a normal alliance mathematically could not
  land a kill. Anchor and clamp are now both **×50**, so one full 2:30 run
  flattens Mk-1 and each mark after is ×1.55 harder.
* **HP bar never moved.** Every attack rewrote `boss_max` from the live power
  anchor while `boss_hp` was subtracted from the *old* max, pinning `hp/max`
  near full. `boss_max` is now re-anchored only on a kill or the weekly reset.
* Kills pay a flat **⬡ 300** to every member (was `250 + 50·mark`, which never
  matched the UI copy).

⚠ **Client and SQL must ship together.** `MAX_XMIT` in `js/alliance-boss.js` and
the `× 50` in `alliance-boss-onekill.sql` are the same number — changing one
without the other silently desyncs the ⚔ meter from the payout.

### Release hygiene fixed in this folder
* **The Aeternum had no art in the deploy folder.** `ship-aeternum.png` and
  `ship-aeternum-c.png` existed only in the working tree — the release's
  headline Ascension-Class hull would have rendered blank. Both are now in
  `ships/` and precached.
* **Offline gaps.** `starforge.js`, `pilot-ascension.js`, `achievements.js`,
  `analytics.js`, `sim-pilots.js`, `moon-colony.css` and `pilot-ascension.css`
  were fetched live only and unavailable offline. Added to the SW `CORE` list.
* Build stamp, all 50 `?v=` cache-busting stamps, `version.json`, the login
  version badge and the SW cache name are consistent at **407 / V3.0 BETA**.
  The update gate blocks logins from anything older.

---

## Pre-push checklist

- [ ] Run the four SQL files above **in order** (2 must follow 1)
- [ ] Confirm `version.json` reads `{"build":407,"label":"V3.0 BETA"}` — the
      update gate locks out older clients, so publishing this before the static
      files are live will bounce everyone
- [ ] Hard-reload once after deploy and open **Starforge, Ship Ascension,
      Casino, Dreadnaught, Galaxy Boxes, Home Citadel, Voidmaw, Shipworks** —
      all nine formerly-blank screens, on a cold cache
- [ ] Alliance ▸ Raid: burn a mark and confirm the alliance page comes back with
      the HP bar lower, or Mk+1 and **⬡ 300** in the wallet

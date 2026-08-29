# Loot Fleet — deploy v256 · build 729 · FIGHTER ASCENSION

Push the **contents of this folder** to the repo root Vercel serves.

Supersedes **v253 (build 726), which is what players are running right now.**
Service worker cache is `lootfleet-v729`. **Login screen reads `BUILD 729`.**
The update gate force-reloads every live session within ~90s of the beacon.

> **This release carries THREE builds.** 727 (`deploy-v254`) and 728
> (`deploy-v255`) were both cut and verified but never pushed, so 726 players
> have seen none of it. v256 carries 727, 728 **and** 729 together — one
> eviction instead of three.
>
> **Consequence for the patch card:** `js/patch-notes.js` shows exactly one card
> per build, keyed on `LF_BUILD` in localStorage. A 726 player jumping to 729
> would have skipped both intermediate cards — including the **Home Citadel
> wave-pay cap, which is a nerf**, and CLAUDE.md is explicit that a nerf ships
> stated out loud or it reads as a bug. The 729 card therefore carries **all 23
> rows** from the three builds: 2 CHANGED, 5 NEW, 16 FIXED.
>
> `deploy-v254` and `deploy-v255` are now superseded and should not be pushed.
> Do not re-seed either from the project root — root is 729.

---

## 1. SQL — TWO FILES, BOTH SAFE TO RUN BEFORE THE PUSH

Both are additive and idempotent. Nothing on the live 726 build calls anything
they create, so they can (and should) go in **first** — that way chat works the
instant the site lands instead of hiding itself for a few minutes.

**`supabase/global-chat.sql` — REQUIRED for build 728.** Creates
`chat_messages` / `chat_mutes` / `chat_bans` / `chat_reports` / `chat_config` /
`chat_blocked`, their RLS, the `chat_*` RPCs, and adds `chat_messages` to the
`supabase_realtime` publication. Seeds `chat_config` with
`on conflict do nothing`, so re-running it **never clobbers a knob you have
turned**. Safe to re-run in full.

> **Smoke-test it before you call it done.** `chat_post()` contains the only
> `FOR ... IN SELECT` loop in the file, and PL/pgSQL plans inner SQL lazily — so
> the file installing cleanly proves nothing about that path. As a signed-in
> user (SQL Editor → Run as, or from the game console):
> ```sql
> select chat_gate();                 -- expect ok/why, no error
> select chat_post('smoke test');     -- expect the inserted row back
> select * from chat_pull(0, 10);     -- expect it, newest first
> delete from chat_messages where txt = 'smoke test';
> ```
> The cheatsheet at the foot of the file has this block too.

**`supabase/temple-retire.sql` — STILL OUTSTANDING FROM 727.** Run once. It is
the cause of the `42883 operator does not exist: record ->> unknown` flood in the
Postgres log: the retired Temple's RPCs are still installed and the pre-fix
`temple_claim()` throws on every call from a stale cached client. Drops the temple
FUNCTIONS by catalogue lookup and **leaves the TABLES alone** — they are the only
record of what players did while that arena was live.

`supabase/feed-health.sql` is read-only diagnosis for the feed. Nothing in it
writes. Run it whenever, or not at all.

**Do NOT run `supabase/temple.sql` — it no longer exists and must not be
recreated.**

---

## 2. EDGE FUNCTION — STILL OUTSTANDING FROM 727

Deploy **`discord-feed`** — all four files from
`supabase/functions/discord-feed/`. A partial upload does not boot. `FEED_VER` is
**727**. Verify:

```sql
select left(content,60) from net._http_response order by created desc limit 1;
```

If `ver` reads 694 the deploy did not land and none of the feed fixes are live —
the war cursor stays frozen at `id=200` where it has been stuck.

---

## 3. PUSH THE SITE, `version.json` LAST

Never bump the beacon ahead of the files. `js/update-gate.js` polls
`version.json` every 90s and force-reloads any session where
`version.json build > LF_BUILD` — publish the beacon first and you evict every
player onto code that is not there yet.

---

## BUILD STAMPS — verified by script

| stamp | value |
|---|---|
| root `game.html` `window.LF_BUILD` | 729 |
| root `version.json` | 729 |
| `deploy-v256/version.json` | 729 |
| `deploy-v256/sw.js` `CACHE` | `lootfleet-v729` |
| `discord-feed` `FEED_VER` | **727** (redeploy required) |

All four agree.

**Verified by script before handover:**

- All **97** `js`/`css` files `game.html` references (77 js, 20 css) diffed
  byte-for-byte against the project root — **zero stale, zero missing, every ref
  cache-busted**.
- `?v=` spread: **13 at 729** (this build), 5 at 728, 5 at 727, 2 at 726, 72 at
  725 — so players keep 84 cached files and re-fetch only what actually changed.
- `deploy-v256/sw.js` confirmed **not** to be the root kill-switch worker, and
  root `sw.js` confirmed still unversioned (it is a kill-switch for an old
  poisoned origin — never give it a `CACHE` version).
- `js/social-upload.js` **excluded** from this folder, and confirmed not
  referenced by `game.html`. It is a local operator tool that reads a service key
  from localStorage and must never ship. It was present in v254 and earlier
  folders; that stays corrected here.
- `audit/` excluded (dev harness for the chat and fighter fit checks).
- `js/fighter-ascension.js`, `js/fighter-ascension-ui.js` and
  `css/fighter-ascension.css` added to the `sw.js` precache list, along with
  `js/fighters.js` and `js/pilot-ascension.js`, which changed this build and
  would otherwise be served stale offline.

### Files at `?v=729` (changed this build)

```
js/fighter-ascension.js     NEW  doctrines, ranks, costs — the only statement of them
js/fighter-ascension-ui.js  NEW  the doctrine screen
css/fighter-ascension.css   NEW  screen styling
css/sheet-cta.css           NEW  pinned sheet action rows
js/fighters.js                   applies doctrines; Wing Tactics; lazy airframe load + retry
js/game-v93.js                   fasc + autoBeacon in ASC_KEEP; Auto Beacon trigger
js/account.js                    fasc max-unioned per doctrine in mergeSaves()
js/ui-v94.js                     Auto Beacon market entry; refusals land in-sheet
js/pilot-ascension.js            wing disbands on screen; real starter hull named
js/dreadnaught.js                hunt lockout clocks survive ascension
js/config-v2.js                  Eternum flyReq cargo 1000 → 300
js/chat.js                       carried from 728
js/patch-notes.js                merged 727 + 728 + 729 card
```

---

## WHAT CHANGED SINCE 726 (what players will notice)

### Build 729

- **Fighter Ascension.** Four permanent wing doctrines — Corona Mantle, Phantom
  Lattice, Nova Reclamation, Apex Sortie — ten ranks each, gated on **Pilot
  Ascension ★10**, account-wide across every bay on every carrier. No RNG; each
  rank costs gold ×5, a galaxy resource ×3 and ◈ prism ingots ×2, so the ladder
  cannot be walked on one income stream.
  - `js/fighter-ascension.js` is the **only** statement of what a rank does and
    what it costs. fighters.js applies it, the screen prints it, nothing
    restates a figure.
  - **Save:** `fasc` is in `ASC_KEEP` and **max-unioned per doctrine** in
    `mergeSaves()` — a rank cannot be spent, refunded or respecced, so the higher
    copy is always the true one. `sanitizeSave()` clamps ranks and never revokes
    one, including a rank from a newer build.
  - **KOTH checked, no change needed.** Corona and Nova are area damage, so the
    worry is a maxed wing blowing past `koth_max_kps` and having bumps silently
    clamped. It cannot: kills are bounded by **spawns**, and the arena tops the
    field up to 26 hostiles at most 6 per 0.25s — a hard **24 kills/second**
    however fast the wing deletes things. The cap is 60/s sustained + 300 burst,
    so there is 2.5× headroom. **Do not raise that knob for this feature.** If a
    future change raises the *spawn* ceiling, redo this arithmetic.
- **Auto Beacon** — 25,000 LootCoins in Hangar ▸ Market ▸ Operations. Fires the
  beacon the moment it is charged, asking exactly what the button asks, so never
  during a boss and never before Lv 30. The sku is a receipt in `purchases`; the
  armed flag is separate, reads true unless explicitly false, and is in
  `ASC_KEEP` so a deliberate OFF survives ascension too.
- **Hunt lockout clocks survive ascension.** `dreadLock`, `dreadProFree` and
  `dreadRespawn` were not in `ASC_KEEP`, so ascending re-opened the whole
  Dreadnaught tier ladder — max level, run the hunts, ascend, repeat. The
  pilot's run resets; the calendar does not.
- **Fighters draw their own airframes**, loaded lazily per marque with retry. A
  failed `Image` is `complete` with `naturalWidth === 0` forever, so one dropped
  fetch used to write that marque off for the whole session and draw a triangle.
- **Refusals land where the player is looking** — in the sheet, above the pinned
  action row, instead of under the backdrop that produced them.
- Auto-sell sells again; ascending disbands the wing on screen; the ascension
  screens name the real starter hull; the Pilot Tree list is readable on a phone.

### Build 728

- **Global chat.** A `CHAT` chip in the status bar opens a non-modal dock —
  bottom sheet on phones, right column on desktop — over whatever the player is
  doing. The battle keeps running behind it. Tap a name for a pilot card
  (level / zone / power / fleet) and add a friend from it. Mute is server-side so
  it roams; `⚑` reports a message with a frozen snapshot of it.
  - **Posting unlocks at Level 10**, from the player's *published leaderboard
    row* — a throwaway account has no row and cannot post. Reading is open to any
    account. **The room opens hardened because there is no moderator roster:**
    `min_level` 10 and `slow_mode_s` 10 are the seeded defaults, and the patch
    card tells players the room starts strict and will loosen. Relax with one
    `UPDATE` each once someone is watching the report queue.
  - **Links are stripped**, not rejected. Zero-width and bidi-override
    characters too.
  - Cooldown 4s, burst 5/30s, 60/hr, duplicate suppression, length 180. **Every
    limit is enforced in `chat_post()`**; the client only prints the rule so the
    composer can state it before the player types.
  - **Writes nothing to the save.** No migration, no `saveWeight()` term, no
    `mergeSaves()` union, nothing in `ASC_KEEP`. This feature cannot corrupt,
    fork or lose a save. The only local values are device facts
    (`lf_gc_read`, `lf_gc_open`).
  - Hides itself behind the login gate, the forced-update veil and the
    onboarding coach.
  - If the SQL has not run, the chip hides and the player is told "chat isn't
    switched on for this server yet" — the filename goes to `console.warn`.
- **Eternum licence: Pilot Ascension ★100 → ★30.** ★100 is ~88 weeks of play, so
  the Celestial Class read as decoration. Nothing else moved.
  - It also fixed a live misinformation bug: **the hangar tile printed `★/50`
    while the gate wanted ★100**, and the ship description said "1,000
    successful *missions*, ★50" (wrong number *and* wrong unit — it counts cargo
    runs). The commission sheet said "10T of every primary and 100,000
    LootCoins" for a bill that is 10T gold, 1T each of fuel/iron/plasma and
    10,000 LootCoins. `flyReq` and `claimCost` are now the single statement and
    every printed figure derives from them.
  - **The binding wall came down too: `cargo` 1000 → 300.** ★30 is ~26 weeks;
    1,000 cargo runs at 2/day is ~500 days, so lowering the star gate alone left
    the Eternum just as far away. 300 runs (~150 days) puts the two halves of the
    licence on the same timescale. Lowering a requirement only ever grants
    access — no pilot loses anything, and anyone already past 300 qualifies the
    moment they load in.
- **Settings → Help & Support now opens Discord** (`discord.gg/4F6cYmP4f`),
  replacing the `support.html` link.

### Build 727 (never reached players — shipping here)

- **Home Citadel wave pay is capped by the clock, not by waves.** *A nerf, stated
  on the patch card with what the player keeps.* Waves still pay 2.2h of base
  production and still raise it permanently; a bank refills at 8h of pay per real
  hour and holds 24. First sessions after a break are unchanged; chaining 100+
  waves an hour now settles at 8× mining rate instead of unbounded.
- **My Systems gets per-hold controls** — rank up or raise a citadel at the
  printed price, jump the map to that hex, or deploy, without leaving the sheet.
  Sorting and citadel-only filter; list position kept across purchases.
- **Ten fighter airframes** — each marque flies its own craft; damage, cadence,
  reach and rarity colour unchanged.
- **Two devices no longer refund a Pilot Tree.** A node kept in one session while
  another handed back the Dread Cores it cost, repeatedly. Nodes are all kept on
  reconcile and the cores are taken once. Nothing already unlocked was touched.
- **Ascending no longer resets expeditions flown**, and the Exploration board
  climbs from today's real total.
- Aegis projectors have an icon and auto-sell correctly; My Systems counts built
  vs natural citadels apart; menus open immediately on phones (the Loot screen
  was redrawing every item several times a second); daily ladder awards retry
  until they land instead of one attempt ~9s after load; natural fortresses show
  under the Citadels filter; the map/list switch is findable; autopilot is on
  every deployment again.
- Discord war feed cursor unfrozen (was pinned at `id=200` for four days) with a
  45-minute staleness guard so old history cannot re-post; `lbUpsert()` bails on
  missing auth instead of cascading ten failures per publish.

---

## POST-PUSH CHECKS

1. **Login screen reads `BUILD 728`.** If it reads 727 the html did not land.
2. **A live session force-reloads within ~90s** of `version.json` going up.
3. **Chat:** sign in, confirm the `CHAT` chip appears in the status bar, open it,
   send a message. In the console `CHAT.trace()` should show
   `off:false`, a non-zero `cursor` and `live:true`. Two browsers should see each
   other's messages within a second or two.
4. **Chat gate:** an account below Level 5 sees the composer disabled with
   "Global chat unlocks at Level 5" *printed in the footer* — not a tooltip.
5. **Eternum:** the Cargo Defense card reads `★x / 30` and the hangar tile's
   licence line matches it. No `/ 50` anywhere.
6. **Support button** in Settings opens `discord.gg/4F6cYmP4f` in a new tab.
7. **War feed cursor moves off 200 within 5 minutes.** If it does not, the Edge
   Function did not deploy.
8. **Postgres log stops filling with `42883`** once `temple-retire.sql` has run.
9. Run **QUERY D** from the Alcyone audit to catch anyone deep enough to notice
   the Home Citadel bank cap.

## MODERATION — DECIDE BEFORE, NOT AFTER

Global chat ships with tools but no roster. All of these are live from the
moment the SQL runs:

```sql
select * from chat_mod_queue('PW');                       -- open reports
select chat_mod_hide('PW', 12345);                          -- hide one message
select chat_mod_ban('PW', '<uuid>', 24, 'scam links', true);-- 24h ban + wipe 24h
select chat_mod_unban('PW', '<uuid>');
select chat_announce('PW', 'Make-good LootCoins are landing now.');
update chat_config set v = '15'::jsonb where k = 'slow_mode_s';  -- incident brake
update chat_config set v = '10'::jsonb where k = 'min_level';    -- raise the gate
```

Config changes take effect on the **next message** — no client push, no
eviction. Moderation **hides**, it never deletes, and `chat_reports` freezes
`snap_name`/`snap_txt` at report time so a later hide cannot erase the evidence.

**A global room with nobody reading `chat_mod_queue` is a liability.** If there is
no one to watch it in the first days, consider launching with
`min_level` at 10 and `slow_mode_s` at 10 and relaxing once you have cover.

---

## ROLLBACK

Re-push the contents of `deploy-v253` (build 726) and set `version.json` back to
`{"build":726,...}`.

**Caveat: the update gate only forces players FORWARD** — it triggers on
`version.json build > LF_BUILD`. Sessions already on 728 will stay on 728 until
they reload of their own accord. Rolling back the site does not recall them.

The SQL does **not** need rolling back. `global-chat.sql` only adds objects that
a 726 client never calls, and `temple-retire.sql` only removes RPCs that no live
build uses. Chat data is not part of any save, so nothing about a rollback can
touch player progress.

# Loot Fleet — deploy v216 · build 486

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v215. Service worker cache is `lootfleet-v486`.

**Headline:** the XP-rate rework (additive bonuses, no cap), the REAL fix for
post-ascension gold coming back, the global layout clip guard, and a Discord
feed that no longer spams — and now talks trash.

---

## ⚠ 0. THE FOLDER MUST MATCH THE SOURCE. Check this FIRST.

The first v216 push shipped **v215 code stamped as build 478**: the folder was
seeded by copying the previous release, and the copy overwrote the patched
`js/` files. Every fix appeared live-but-broken. Before any push, confirm every
file `game.html` references is identical to the project copy — not just that the
build stamps agree.

```bash
# from the repo root, after copying the folder in
grep -o 'LF_BUILD = [0-9]*' game.html; cat version.json; grep -o "lootfleet-v[0-9]*" sw.js
# spot-check two fixes that only exist in v216:
grep -c "GOLD RESCUE — REMOVED" js/game-v93.js   # must be 1
grep -c "stars \* 5e6" js/account.js             # must be 1
```

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 486 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `486` |
| Update beacon | `version.json` → `build` | `486` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v486` |
| Project root beacon | root `version.json` (source tree) | `486` |

The fourth is easy to miss and now matters more than ever: the root beacon
drifted nine builds behind, and the in-session update gate compares
`version.json` against `LF_BUILD` — a stale beacon silently disables update
enforcement for every client. Root `sw.js` is NOT a stamp; it is a deliberate
kill-switch worker for an old poisoned origin, and must stay un-versioned.

```bash
grep -o 'LF_BUILD = [0-9]*' game.html; cat version.json; grep -o "lootfleet-v[0-9]*" sw.js
```

---

## Step 1 — redeploy the Discord Edge Function (REQUIRED — this is the spam fix)

Supabase → **Edge Functions** → **discord-feed** → **Code** → select-all,
delete, paste **`supabase/functions/discord-feed/index.ts`** → **Deploy**, and
wait for the confirmation (navigating away cancels it).

**Verify it actually deployed** — the running build now stamps its own version:

```sql
select status, content from net._http_response order by created desc limit 3;
```

Must show `{"ok":true,"ver":216,...}`. **No `ver` field means the old build is
still running** — that is how the first attempt silently failed.

Why it is not optional: PostgREST silently caps every select at **1000 rows**.
The feed's `feed_seen` cursor table outgrew that, so tiles that fell off the
truncated read were re-announced as brand new **every 2 minutes, forever** — the
"Wolfe claimed Solo α-3" wall. Those were never fake players; they were echoes
of real one-time claims. The new build pages all reads, and dedupes + chunks +
verifies the cursor write (a failed write now returns a red row in
`net._http_response` instead of silently spamming).

Also in this build: the **trash-talk engine** — takeovers, repels, throne
changes, spire seizures, land grabs and big bets open with a randomized quip
(deterministic per event, so a retried tick posts the identical joke), and the
loud ones carry a meme GIF. Tuning lives at the top of the file: `QUIPS` (add
lines), `GIFS` (paste any direct GIF URL), `GIF_EVERY` (1 = GIF on every loud
event; 2–3 to calm it). A dead GIF URL renders as a card without an image —
never blocks the post. Kaevith hull cards now pull ship art from
`https://lootfleet.com/ships/…`.

No SQL changes and no new cron this release.

## Step 2 — push the site

Folder contents to the repo root, commit, let Vercel build.

## Step 3 — hard-reload once

`Cmd/Ctrl + Shift + R`. Cache name changed, so the old bundle is evicted on
first load.

---

## What shipped

### ↻ LIVE UPDATE ENFORCEMENT — `js/update-gate.js` (build 486, operator note)

Until now the version check ran **once, at page load, and only blocked login**.
Anyone already playing never learned a new build had shipped and kept running
old code indefinitely — exactly what the gate exists to prevent, since stale
code on one device is what forks a save between iPad and PC.

The gate now runs **during play**: it polls `version.json` every 90s while the
tab is visible (and on regaining focus). On a newer build it pulls the fleet out
of combat, saves locally **and pushes to cloud**, then raises a full-screen
blocking veil — every click, tap, key and scroll behind it is swallowed, with no
dismiss — runs a 60s countdown, and force-reloads onto the new build (purging
caches and updating the SW). Offline or failed fetches never lock anyone out.

**What this means for releases:** bumping `version.json` now actively evicts
every connected player within ~90 seconds. Push the site FIRST, then confirm the
beacon — never bump the beacon ahead of the files. Players still on 485 or older
pick the gate up on their next manual reload; from then on it is automatic.
Test with `UPDATEGATE._test()` in console.

### SHARED-OWNERSHIP BUG — two players holding the same system (build 479)

Same root cause as the Discord spam: `territory.loadAll()` selected the whole
table with no pagination, and PostgREST silently caps every select at 1000 rows.
Once `territory` outgrew that, each client received a DIFFERENT partial map —
tiles past the cap read as unowned, so two players could both hold one system,
each seeing themselves as the owner ("I can attack it but it says I'm defending
it, and I can abandon it"). Now paged. `isOwned()` is also server-authoritative:
when the shared map carries another player's claim for a tile, the stale local
flag is dropped on the spot.

### ◈ MY SYSTEMS panel (builds 479–481)

The `◈ N/M Systems` chip on the My Galaxy legend is now a button — breathing
glow, sweeping sheen and a **MANAGE** CTA, turning amber with a blinking FULL
badge at the tile cap. It opens every hold you own: per-hour revenue by
currency, citadel rank, ring/level, VOID/KAEVITH/DEEP/HERE tags, and one-tap
abandon with a confirm. Header totals your whole empire's hourly income; sorted
richest first. Home citadel can never be abandoned.

### CITADEL RANK HERO on the tile sheet (builds 481, 485)

A fortress rank changes every number under it, and on a rival's tile the rank
appeared nowhere at all. Every citadel tile now opens with a hero banner: giant
rank numeral, five pips, and what the rank buys (output ×N, defence +N%).
Colour-coded gold (yours) / red-orange (enemy, holder named) / amber (unclaimed
natural fortress). Natural fortresses report **Rank 5** — they are seeded at full
strength, which is why they pay ×1000 with no builds.

This exposed a real gap: rival citadel ranks were **never fetched**.
`territory.loadAll()` didn't select `citadel_lv` at all, so the game had no idea
how fortified an enemy fortress was. Now pulled on load and on live updates.

### MAIL → MAP jump (builds 482–483)

Every galaxy war report carries a **◎ SHOW ME — PLAN THE COUNTERATTACK** button:
opens My Galaxy, glides the camera to that hex, pings it, and opens the tile
panel. Reports filed before tile ids were recorded resolve through
`GAME.tileIdByName()` — names are deterministic per coordinate, so the galaxy is
walked once into a cached index (Void spires and House holds included) — which
means historical reports get the button too.

### Smaller (builds 484–485)

- **Iron rendered grey** in My Systems and Empire Income. All four currency
  colours now mirror `GALAXYMAP.RES` exactly, so a resource reads identically
  everywhere.

---

## What shipped in build 478

### XP RATE REWORK — additive, uncapped, legible

Old: every XP source multiplied every other (×1.02 VIP × ×3.0 Neural Uplink ⇒
"+206%"), clamped at +1000%, with the ship-ascension and Kaevith multipliers
compounding into nonsense. New model in `gainXp`/`xpFleetInfo`:

- **One base rate**: 100%, or **200% on LootFleet Pro**.
- **Every bonus is a flat % of that base** — VIP, Pilot Tree XP nodes, Neural
  Uplink, Combat Computer, Kaevith Resonance — summed, then multiplied in:
  `total = base × (1 + Σ bonuses/100)`.
- **No cap.** Additive stacking grows linearly, so a 7% Pilot Tree node adds
  exactly 7% of base — deep Pilot Tree builds finally have a reason to buy XP.
- UI (hero chip, My Ship pill, Kaevith briefing) shows the TOTAL rate
  (100% = normal) with the per-source breakdown in the tooltip. All cap copy
  removed.

### POST-ASCENSION GOLD CAME BACK — the actual cause (cloud save merge)

Two separate paths could restore a pre-ascension balance. Both are closed.

**1. The save merge (the dominant one).** `saveWeight()` in `account.js` ranks a
save by gold, level, zone, kills and hull upgrades — but **not by Pilot
Ascension stars**. An ascension resets level to 1 and gold to 0, so the
freshly-ascended save weighs FAR less than the copy saved seconds earlier. On
the next login `mergeSaves()` applied its progression-first rule, judged the
pre-ascension cloud copy "more progressed", and restored it wholesale — gold,
level, inventory, the lot. Exactly "105 DDc gold again after ascending and
relogging", and it was silently rolling back whole ascensions too.

Fixed at both levels: ascension stars are now a **dominant term in
`saveWeight`** (5e6 per star, so one star outranks any amount of gold — this
also stops the best-ever vault offering the pre-ascension save as "heaviest"),
and `mergeSaves` now takes **more stars wins, unconditionally** as the first
tiebreak, above weight and timestamps. Stars only ever increase, so the
higher-star copy is unambiguously the later timeline. `pasc.stars`/`pts`
themselves are also merged monotonically.

**2. The old gold-crush rescue migration.** It read the `lf-best`/`lf-backup`
local snapshots and restored the larger balance whenever its `goldRepairVer`
stamp was unset — and ascension resets that stamp. Whole block removed (the
item-stat repair it shipped with remains).

### PILOT TREE — no more relog to see the tiles

Ascension left `state.pilot = null`; the origin seed only existed in the boot
path, so the tree canvas drew zero tiles until a full reload. The reset now
seeds `{'0,0':1}` immediately, `nodes()` self-heals, and the cached bonus
aggregate is dropped on ascension (it was still applying pre-ascension node
buffs until relog).

### GLOBAL LAYOUT CLIP GUARD (`css/fit-guard.css` + `js/fit-audit.js`)

Root cause of "text/art cut off" (Voidmaw arena, FIGHT button, grand-prize
copy): screen bodies are flex columns inside a fixed-height shell, and flex
children default to `flex-shrink:1` — short viewports crushed fixed-height
cards into their own `overflow:hidden` before the body ever scrolled.

- `fit-guard.css`: children of `.scr-body`/`.sheet-body` never shrink — short
  windows scroll. Deliberate fill panes (Pilot tree canvas) opt out by
  declaring their own flex. Images can't spill sideways; long tokens wrap.
- `fit-audit.js`: opt-in clip auditor — open with `?fitaudit` (or
  `FITAUDIT.on()` in console); clipped boxes get red outlines + a counter chip
  with a console table. QA every new screen at 360×640 and a short landscape
  window. Zero cost while off.

### Balance / fixes

- **Ship crit mods** compressed to a sane ladder (top end: Titan Sina 95%,
  Aeternum 90%, Dread Omega 85% … Godshard/Vhorn 50%) — crit chance is capped
  at 100% in `computeStats`, so the old 330–660% values were pure waste.
- **Territory ranks board** now reads the same `resourceRates()` the Galaxy
  screen uses (the old inline copy multiplied citadels 1000×lv vs the real
  10×lv and skipped the ×25 yield); sim rivals' derived revenue rescaled to the
  same units (was ×1.028^level ⇒ 1e12/hr fantasy numbers).
- **Empire Income** gains the **Home Citadel** row (wave, hourly rates, damaged
  state) and no longer flickers during a zone grind (hosts rebuild only when
  their HTML actually changed).
- **Badges**: COLLECT ALL button claims every earned badge across all 15 chains
  in one tap (summed LootCoins, one toast).
- **Sell-on-pickup + pickup floor survive ascension** (added to ASC_KEEP).
- **Ship Ascension**: unaffordable costs are now readable — disabled buttons
  keep full contrast and the short resource turns red instead of a 38%-opacity
  strikethrough.
- **Legibility pass** (readability.css): Moon Colony, Skills, Prism Mining
  (miner descriptions, mining speed, zone/lv/today lines) all up 1.5–2.5px;
  count badges (skill points, dread hunt, voidmaw, missions, bag) are bigger
  and dead-centred; mission/badge progress rings enlarged with the count
  properly centred.

### Cache busting

Changed js/css referenced from `game.html` carry `?v=` stamps from the build
that last touched them (478–486). New precache entries in `sw.js`:
`css/fit-guard.css`, `css/readability.css`, `js/fit-audit.js`, `js/update-gate.js`.

---

## Still open (carried from v215)

- **The Stripe webhook is still not deployed.** Live payment links take money
  with nothing recording or fulfilling it. Still the most serious open item.
- Check last-deployed dates on the other Edge Functions: `stripe-webhook`,
  `digest-build`, `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` succeeded at 00:05, and watch sim-held territory.

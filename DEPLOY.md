# Loot Fleet — deploy v216 · build 478

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v215. Service worker cache is `lootfleet-v478`.

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

## ⚠ THREE STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 478 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `478` |
| Update beacon | `version.json` → `build` | `478` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v478` |

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

Changed js/css referenced from `game.html` are at `?v=478`. New precache
entries in `sw.js`: `css/fit-guard.css`, `css/readability.css`,
`js/fit-audit.js`.

---

## Still open (carried from v215)

- **The Stripe webhook is still not deployed.** Live payment links take money
  with nothing recording or fulfilling it. Still the most serious open item.
- Check last-deployed dates on the other Edge Functions: `stripe-webhook`,
  `digest-build`, `notify-unsub`, `iap-validate`, `delete-account`.
- Confirm `lf-daily-ranks` succeeded at 00:05, and watch sim-held territory.

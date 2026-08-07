# Loot Fleet — deploy v216 · build 478

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v215. Service worker cache is `lootfleet-v478`.

**Headline:** the XP-rate rework (additive bonuses, no cap), the post-ascension
gold-dupe fix, the global layout clip guard, and a Discord feed that no longer
spams — and now talks trash.

---

## ⚠ THREE STAMPS MUST AGREE — verified for this folder. Re-check before every push.

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

Supabase → **Edge Functions** → **discord-feed** → **Code** → paste
**`supabase/functions/discord-feed/index.ts`** → **Deploy**.

Why it is not optional this time: PostgREST silently caps every select at
**1000 rows**. The feed's `feed_seen` cursor table outgrew that, so the tiles
that fell off the truncated read were re-announced as brand new **every 2
minutes, forever** — the "Wolfe claimed Solo α-3" wall. The new build pages all
reads, dedupes + chunks + verifies the cursor write (a failed write now returns
a red row in `net._http_response` instead of silently spamming).

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

### POST-ASCENSION "105 DDc GOLD" — cause found and deleted

The old gold-crush *rescue migration* read the `lf-best`/`lf-backup` local
snapshots and restored the larger balance whenever its `goldRepairVer` stamp
was unset. Pilot Ascension zeroes gold AND resets that stamp — so the next load
handed every ascended pilot their entire pre-ascension hoard back. The whole
gold-recovery block is removed (the item-stat repair it shipped with remains).
Nothing may resurrect gold from snapshots.

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

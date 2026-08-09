# Loot Fleet — deploy v216 · build 501

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v215. Service worker cache is `lootfleet-v501`.

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

| Stamp | File | Build 501 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `501` |
| Update beacon | `version.json` → `build` | `501` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v501` |
| Project root beacon | root `version.json` (source tree) | `501` |

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

### 🔒 BOLT-DOWN PASS (build 501)

Full regression sweep of everything changed this session — 18 checks, all green:

| area | verified |
|---|---|
| XP cap | `cap=1000`, `mult` clamps to ≤10, `pct ≤ cap` |
| Century XP | L50 1.132 → L150 1.168 → L250 1.176 → L350 1.186 (widens every band) |
| Century difficulty | zone 99→100 HP ×1.65, 199→200 ×1.31 |
| Hull costs | Sovereign 1.06e7 vs Mothership 1.37e7; Splinter ≤ 2× Cruiser |
| Sovereign drops | rim share exactly 0.704% |
| Dread LootCoin | 35k/45k/55k/65k/78k/92k — all under 100k |
| Pro | `PRO_PERKS` complete, `xpMult=5`, every surface reads it |
| Pro offer | module loaded, `.nav-btn.active` selector resolves |
| Boss timer | reports `speed` and the 300s floor |
| Speed tiers | value always in {1,2,3,4,5,10} |

**Cache-bust gap closed.** `js/config.live.js` and `js/galaxy-box.js` were referenced WITHOUT
`?v=`, against the project's own contract — players could hold a stale copy of either
indefinitely. Both now versioned.

Release folder audited: 69 referenced js/css files, **zero stale, zero missing**, root
`game.html` byte-identical to the release copy, all six build stamps agree.


### ⚒ HULL UPGRADE COSTS NOW DERIVE FROM POWER, NOT ARRAY POSITION — `js/game-v93.js` (build 500)

`shipUpgradeCost()` priced a hull off `C.SHIPS.findIndex()`. That array is **display order** —
event hulls are appended as they ship — so price and power had come completely apart:

| hull | power | old cost ×  | note |
|---|---|---|---|
| Cruiser | 28 | ×3.24 | |
| Kaevith Splinter | 20 | **×45,500,000** | weaker than a Cruiser, 14M× the price |
| Ember Mote | 28 | **×860,000,000** | identical power to a Cruiser |
| Mothership | 432 | ×2,080 | |
| Kaevith Sovereign | 396 | **×265,000,000** | ≈ Mothership power, 127,000× its price |

The tier is now derived from the hull's own mods (`hp + 2×dmg + 3×multishot + critDmg`) on a
log fit calibrated against the mainline, so tuned hulls barely move and only the outliers change:

- Battleship 1.02e5 → 1.00e5 · Oblivion Final 2.23e9 → 2.15e9 · Dread Omega 7.59e10 → 7.18e10
- Kaevith Splinter 1.37e11 → **3.00e3** · Sovereign 7.96e11 → **1.06e7** · Godshard 1.43e12 → **1.54e9**
- Ember line corrected identically (same bug, worse magnitude), Aeternum and Titan Sina brought
  down to their real power tier

Hulls added in future are priced automatically — there is no list to maintain. Result cached per
key. **The Ember hulls were fixed alongside Kaevith**: same root cause, and leaving them would
have recreated the same complaint next week.

### ✦ XP CAP CONFIRMED AT 1000% TOTAL

No change — the build-499 cap is what was wanted. For the record: Pro's 500% base counts toward
it, so a member needs only **+100% in bonuses** to reach the ceiling versus **+900%** for a free
pilot. Pro gets there fast but cannot get there on the subscription alone.


### ✦ XP RATE CAPPED AT 1000% — `js/game-v93.js`, `js/ship-panels.js`, `js/ui-v94.js` (build 499)

The Aug 2026 additive rework killed runaway *compounding* but left the total unbounded, so a
fully-built account could still push the rate somewhere the level curve was never designed
against. `XP_RATE_CAP = 1000` caps the **total** rate (10× normal) — not any single source, so
it is reached from whatever combination the pilot actually built.

`xpFleetInfo()` now returns `rawPct` (what the stack would pay), `pct` (what is paid),
`capped`, `cap` and `headroom`, so the UI can be honest instead of silently discarding the
overflow. Both readouts consume it:

- **My Ship ▸ XP Rate pill** — reads `420%` normally with the full source breakdown and the cap
  named; at the ceiling it reads **`1000% · MAX`** in gold and the tooltip opens with "CAPPED.
  Your stack pays 1340%, but the XP rate is capped at 1000% — that is what you are earning…
  Further XP bonuses add nothing until something drops off." Within 10% of the cap it warns how
  much headroom is left, so nobody spends a Neural Uplink rank on nothing.
- **Hero power chip** — same states, reusing the `.hero-xp-chip.capped` gold style already in
  `style-v2.css` from the previous cap era.

**Pro members are affected most and are told so.** Pro's 500% base counts toward the cap, so a
member starts halfway up with 500 points of bonus headroom rather than the 1000 a free pilot has.


### ⚡ 10× SPEED KEPT BEING REVOKED — `js/game-v93.js`, `js/account.js` (build 498)

"After a while it stops working and resorts to 5×." Three separate holes, all from
`secretSpeed` being treated as a **setting** rather than the one-time entitlement it is.
`purchases`, `proUntil` and `credits` are all handled correctly; this bare boolean was
missed by every one of them.

**1. Ascension wiped it — `KEEP` list.** `secretSpeed` was not in the carry-over list, so
every ascension revoked the Mothership easter-egg unlock. Added.

**2. A stale cloud save wiped it — `mergeSaves()`.** The union covers `purchases`,
`ownedShips` and `blueprints`, but `secretSpeed` is not a key inside any of them, so a
cloud copy predating the unlock erased it on login — the same class of bug as the
"Pro/credits gone the next day" fix that comment describes. Now OR-ed across both copies.

**3. `sanitizeSave()` demoted it and gave no way back.** The old two-liner skipped anything
sitting at exactly 5, then dropped an unentitled 10 to 1 — and because the HUD hides the 10×
pill when `secretSpeed` is false, the highest tier a Pro player could still see and tap was
5×. That is exactly the reported symptom. Each tier is now validated against its own
entitlement, 10× tested first, and an earned 10× is never touched. Nine-case table verified:
10× survives with or without Pro, 5× still drops on a lapsed subscription, 4× still needs its
LootCoin unlock, out-of-range values still fall back to 1×.

**Players who already lost it are not auto-granted.** Owning the Mothership does not prove the
easter egg — it is also a 100,000-LootCoin purchase — so granting on that basis would hand the
secret tier to people who bought a ship. Re-triggering the easter egg restores it (`gotSpeed`
re-arms whenever `secretSpeed` is false), and from this build it stays.


### ◈ KAEVITH SOVEREIGN — 5× RARER — `js/game-v93.js`, `js/ui-v94.js` (build 497)

`XEN_BASE_W[3]` **0.901 → 0.17509**. Solved for the share ratio rather than divided:
dividing the weight shrinks the denominator too, so the other hulls would absorb the freed
probability and the realised factor would land near 3×, not 5×. Measured:

| ring | before | after | factor |
|---|---|---|---|
| 25 (rim) | 3.520% | 0.704% | **5.00×** |
| 13 | 2.563% | 0.509% | 5.04× |
| 1 | 1.160% | 0.228% | 5.10× |

New rim split: 45.18 / 48.57 / 4.70 / **0.70** / 0.86%. The Sovereign is now the scarcest
hull in the line, below the Godshard. The overall chance of *a* hull dropping is unchanged —
this only moves which hull a winning roll pays.

**The tooltips had the hull names wrong.** Both prose blocks read "the Glaive and **Harbinger**
are 5× rarer, and the **Sovereign** is 10× rarer" — but the Kaevith line is Glaive (xen3),
Sovereign (xen4), Godshard (xen5). Harbinger is a Dread-class hull and is not in this table at
all, so the note was describing the Sovereign's rarity while pointing at the Godshard. Corrected
in the void-tech briefing and the post-zone result sheet, and `XEN_RARITY_NOTE.xen4` is now
`25× rarer`. The roster's per-hull percentages were always read live from `xenSplit()`, so those
were correct throughout and update themselves.


### 🔧 BUILD 495 FOLLOW-UPS — both mechanisms now actually do what they claim (build 496)

**1. The Pro offer's "never mid-combat" guarantee was not implemented — `js/pro-offer.js`.**
`inCombat()` queried `.nav-btn.on[data-screen]`, but the live class is `active` (set in
`showScreen`). It therefore always returned false: the offer could pop **during a run**, and
`_queued`/`flush()` plus the drain hook in `showScreen()` were dead code because nothing ever
queued. One-word selector fix; the promise in the module docstring now holds.

**2. The XP century steepening did not widen the per-level gap — `js/config-v2.js`.**
The first pass used 1.2–2.8% per level and was cancelled almost exactly by the decaying
linear term `(120 + 120*level)`, whose own ratio falls from 1.0196 at L50 to 1.0066 at L150.
Measured result: **L150 came out at 1.1308× per level, BELOW L50's 1.1318×** — 140→141 still
felt like 40→41, precisely what the comment claimed to have fixed.

Rates are now set against the measured ratio `xpToNext(l+1)/xpToNext(l)`:

| | L50 | L150 | L250 | L350 | L450 | L550 |
|---|---|---|---|---|---|---|
| gap per level | 1.132 | **1.168** | **1.176** | **1.186** | **1.196** | **1.207** |

Pre-100 is untouched; each century is now about a point wider than the last.

The flat `[1,2,3,6,10,10]` band pass was **removed** in the same step — it was a blunt version
of the same idea, and keeping both stacked two band taxes on each other. Net effect at L150 is
roughly 2.6× the old requirement, not the 6 orders of magnitude that leaving both in would have
produced. Level caps are 150 + 50/star, so the 100s band is where most pilots live and the deep
bands are gated behind ascension stars.


### 📈 CENTURY CURVES — XP GAP AND DIFFICULTY BOTH STEEPEN PER 100 — `js/config-v2.js` (build 495)

**XP.** The band walls were STEPS: the curve jumped once at each century line and then
climbed at the same 1.11/level it used at level 3, so the gap between neighbouring levels
barely widened inside a century — 140→141 felt like 40→41 with a bigger number on it.
Every level above 100 now compounds an extra per-level rate, and the rate itself steps up
each century: **+1.2%/level in the 100s, +1.6% in the 200s, +2.0% in the 300s, +2.4% in
the 400s, +2.8% past 500.** Levels 1–99 are byte-for-byte unchanged.

**Difficulty.** `dungeonScale()` tapers past zone 100 and both enemy ramps flattened around
zone 81–91, so deep zones were getting *easier* relative to a levelling fleet. Enemy HP and
damage now take a century multiplier — **HP ×1.4 / ×1.8 / ×2.2 / ×2.6 / ×3.0** and
**damage ×1.25 / ×1.5 / ×1.75 / ×2.0 / ×2.25** per 100-zone band.

Applied to the enemy ramps only, never to `dungeonScale` itself: item power rides that
curve, and rescaling it would desync every item already rolled — that is exactly what the
scaleVer-4 migration exists to repair, and it is not a thing to trigger twice.

### ★ CONTEXTUAL PRO OFFER — `js/pro-offer.js` (new)

A hero sheet that appears where Pro would have just helped, and nowhere else. The restraint
is the feature:

- never for members, never below level 10, **never mid-combat** (a trigger that fires during
  a run is queued and shown at the next quiet screen, so it cannot cost you a fight)
- **each trigger fires at most once for the life of the account** — the offer is an argument,
  not a nag
- a 20 h global cooldown on top, so two triggers in one session can't double up
- dismissals compound: two brush-offs → 3-day cooldown, four → a week. Saying no makes it
  quieter.

Four triggers, each naming the benefit the player just wanted: **empire at tile cap**,
**Dreadnaught tier spent for the week**, **a level-up past 100** (where the new curve bites),
and **a 6h+ offline return**. There is deliberately no speed trigger — tapping the locked 5×
tier already opens the Pro sheet, and answering a question beats interrupting.

All figures render from `PRO_PERKS`, so the sheet cannot drift from the product.


### 🔍 BUFF AUDIT — three dead buffs found and wired (build 494)

Traced every buff source to its consumption site: Pro (`PRO_PERKS`), Pilot Tree
(`DREAD.combatMods`/`mult`/`dmgVs`), ascension perks (`PASCEND.mult`, `beaconMods`),
VIP, ship `mods`, and the beacon. Three were not doing what they claimed.

**1. Elite Damage did nothing against elites — `js/game-v93.js`.** `resolveHit()` gated the
Pilot Tree call on `e.isBoss`, but `dmgVs()` adds `eliteDamage` for
`isSuper/isDread/isCitadel/isClone`. So the bonus only applied when the target was *also* a
boss: **Apex Predator (+16/+16) and every Elite Damage node were inert against
dreadnaughts, citadels and clone fleets** — the exact targets they name. Both the tree and
the ascension perk now gate on the same elite set.

**2. Pro's Dreadnaught attempt did not exist — `js/dreadnaught.js`.** `dreadAttempts: 1` was
declared in `PRO_PERKS` and sold on the purchase sheet, but nothing read it. It is now a
real extra hunt per tier per week (`DREAD.proAttempt`), consumed only when the tier was
genuinely locked, refreshed with the weekly reset. Copy corrected from "+1 attempt every
day" — the hunt is weekly per tier, so the old line was wrong twice over.

**3. Gold Find pill counted a bonus the kill path never pays — `js/ship-panels.js`.** VIP's
gold perk is empire-side by design (AFK, Home Citadel waves, events) and is not applied to
kills, but the pill multiplied it into the kill rate. Gold Find is now kill sources only
(Pilot Tree × Prize Courts × Pro — the tree's `goldFind` was missing entirely), with VIP
split out as its own **Empire Gold** row stating where it applies.

Verified correct, no change needed: `dmgReduce`/`regen` from the tree (folded at
`computeStats` L469–470), `rangePct` (L502), `xpGain`, `lootQuality`, `pickupRadius`,
all four beacon perks, Wing Tactics, Bastion Command, Deep Core Drills, Fortune Lattice,
and ship `mods`.


### 🩺 SAFE BOOT OFF — `js/game-v93.js` (build 493)

The build is stable, so the degrade-and-warn path is retired. `SAFE_BOOT` is a `const`
at the top of the boot sequence, currently `false`:

- `__lfSafeBoot` never arms, so the offline sim, return brief and v4 gear remap always run
- the SAFE BOOT banner is gone, as is the "your last session ended with an error" banner
- a stale `lf_boot` breadcrumb is cleared at boot, so a marker left by a long-dead session
  can't greet a returning player with a warning about a crash that wasn't theirs

Kept: the boot breadcrumbs themselves, the console line naming the dying phase, the JS
error capture, and PLAY RECOVERY (the mid-combat freeze path) — that one is a real
reload-loop guard, not a warning. Flip `SAFE_BOOT` to `true` to restore the old behaviour.


### ⚡ EVERY PRO SURFACE NOW READS `PRO_PERKS` — `js/ui-v94.js`, `js/payments-v91.js` (build 492)

Build 488 raised Pro to 5× XP but four user-facing surfaces still had **2× typed as a
literal**, so the HUD chip sold 2× XP while the purchase sheet three taps away sold 5× —
and the post-purchase receipt understated what the player had just paid for:

- HUD Pro chip + its tooltip (`syncProCta`)
- the pro-offer upsell card (`po-desc`)
- both receipt labels in `payments-v91.js`

All four now read `GAME.proMods().perks` at render time, so changing a value in
`PRO_PERKS` updates every surface at once. This was the third report of the same
pill-vs-engine drift this session; the table is now the single source for all of them.


### ⬡ THE LOOTCOINS PAGE STOPPED CLAIMING SOMETHING FALSE — `js/ui-v94.js` (build 491)

The store hero read "Cosmetics & convenience — never power". LootCoins buy the Carrier,
Mothership, Oblivion and event hulls (`LC_SHIP_OFFERS`), Black Market cosmic and
primordial gear rolls, the permanent 4× battle speed tier, and `credits` are a line item
in every Dread-class hull's build cost. That is power, and a store that denies what a
player can plainly see on the buy screen costs more trust than it saves.

The hero now reads "Hulls, gear & cosmetics — a shortcut, not a secret tier", above a
WHAT THEY BUY block listing all five categories, and a plain statement that some of it is
power — with the honest boundary that nothing is locked behind payment and every buff is
readable in Hangar ▸ My Ship. The stale header comment in `payments-v91.js` is corrected.

**Brand doc still carries the old rule.** `brand.html` lists "cosmetics only — never power"
as a house rule and a launch-checklist item. I left it alone — it is your brand voice to
change, not mine. Worth a decision before launch assets go out.


### 🛡 THE PENDING TILE SHIELD CAN NO LONGER OUTLIVE THE VISIT — `js/game-v93.js` (build 490)

Build 488 deferred the 24 h stamp to first blood, but only `goSafeHangar()` cleared the
pending record — and **Bail and Dock both route through `selectDungeon(0)`**, which never
touched it. So the retreat looked fixed, and then the shield landed on the player's next
kill anywhere in the game, on a tile they had already left. Worse than the original bug,
because the stamp was decoupled from the action that caused it.

Fixed on both sides: `selectDungeon()` clears `rt._pendShield` alongside the siblings it
already resets, and `commitTileShield()` now refuses to stamp unless `state.currentSystem`
still equals the pending tile — so any exit path added later is safe by default.


### ✦ THE NEW PRO PERKS NOW REACH THE STATS PANEL — `js/ship-panels.js` (build 489)

Same class of bug the Boss Damage pill had: Pro's 2× gold and +50% drop chance were
multiplied into the kill path but never read by `bonuses()`, so Gold Find understated a
subscriber's real rate by half and Loot Quality omitted the drop bonus entirely — while
the Pro pill's own tooltip advertised both. Both pills now fold in `GAME.proMods()` and
name Pro in the breakdown. `beaconCdCut` and `tiles` were already consistent (read live
through `beaconStats()` and `tileCap()`).


### ⚠ RUN THIS SQL — `supabase/alliance-boss-repair.sql` (build 488)

**The alliance raid needs a database migration this release.** Report: "did 2
hits and health is still full."

Two files defined `alliance_attack()` and `_al_boss_hp()`. `alliance-boss-setladder.sql`
carries the current design (fixed hull `1e6 × 4^(mark-1)`, no per-attack cap);
`social.sql` still carried the old power-anchored pair — a **5e13 hull floor** and a
per-attack clamp of `leaderboard power × 25`. Whichever ran last won, so re-applying
the omnibus silently reinstalled the old behaviour. The client spawns an arena boss
whose hull literally IS `boss_hp` and transmits raw combat damage, so it fought a
1e6 boss while the server held a 50-trillion one and then clamped the damage on top.

`social.sql` is corrected in this build so it can no longer regress. Run
`alliance-boss-repair.sql` once to fix a database that already drifted — it also
rebases every live alliance onto the ladder, preserving the fraction already burned.

### ★ LOOTFLEET PRO IS NOW A FIVE-SYSTEM SUBSCRIPTION — `js/game-v93.js`, `js/ui-v94.js`

XP goes **2× → 5×** on the base rate, and Pro stops being an XP-and-speed perk.
One `PRO_PERKS` table in `game-v93.js` feeds every hook and the purchase sheet, so
the sell copy and the game cannot disagree:

| Perk | Value |
|---|---|
| Experience | **5×** base rate (was 2×) |
| Battle speed | exclusive 5× tier |
| Gold | 2× per kill |
| Loot | +50% drop chance |
| Beacon | −25% recharge |
| Empire | +10 tile cap |
| Dreadnaught hunt | +1 attempt daily |

Because every other XP bonus is a flat % of base, the 5× multiplies all of them.

### ⏱ BOSS TIMER MATCHES THE SPAWN AT 4× / 5× — `js/game-v93.js`

`update()` is handed `dt` already multiplied by `gameSpeed`, so the boss meter counts
SIM seconds while the HUD printed them as wall-clock: at 5× a "300" burned down in 60
real seconds. `getBossInfo()` now divides by the live speed. It also accounts for the
300-sim-second floor since the last boss, which it ignored entirely — the meter could
sit at 0:00 with no boss spawning. It now reports whichever gate clears last.

### 🛡 RETREATING NO LONGER BURNS A TILE'S 24 H SHIELD — `js/game-v93.js`

`warp()` stamped `state.tileCd[k]` on warp-**in**, so entering a contested tile and
bailing to the hangar shielded it for a day without a shot fired (My Galaxy and Void
spires alike). The stamp is now pending on `rt._pendShield` and committed by
`commitTileShield()` on the first kill. `goSafeHangar()` clears it.

### ⚔ NO MORE FIGHTING YOUR OWN CLONE FLEET — `js/game-v93.js`

The ordinary-tile level gate read `!owned && tile.level > state.level + 10`, leaving
exactly the hole the Void gate above it was written to close: ascension keeps your
territory but resets your level, so an owned Lv-300 system and a fresh Lv-5 pilot meant
warping into a zone garrisoned by your own clone fleet for free high-level XP. The gate
now applies to owned tiles too — you keep the tile and its income, and fight on it again
once you have re-earned the level.

### ◈ DREAD-CLASS PRICING + THE LOOTCOIN MARK — `js/config-v2.js`, `js/ui-v94.js`

`megaCostHTML()` drew LootCoins as a plain orange disc (`◉`) that matched nothing else
in the game; it now uses the real hex-coin SVG like every other price. Dread hull
LootCoin costs cut 10× — 350k/450k/550k/650k/775k/900k → **35k/45k/55k/65k/78k/92k**,
all under 100,000. Other currencies unchanged.


### ☠ BOSS DAMAGE PILL COUNTED ONLY HALF THE BUFF — `js/ship-panels.js` (build 487)

Hangar ▸ My Ship read `DREAD.combatMods().bossDamage` and nothing else, so the
pill showed the **Pilot Tree** contribution alone. The Siege Protocols ascension
perk (`PASCEND.mult('boss')`, 12%/rank) was missing from the readout even though
`resolveHit()` has always applied it. A pilot with +66% tree and 25 ranks of Siege
Protocols saw `+66%` on a build that was really hitting for far more.

Combat was never wrong — only the display. The pill now folds both sources and
reports the effective figure the engine uses (the two multiply), with a tooltip
breaking out each half.


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

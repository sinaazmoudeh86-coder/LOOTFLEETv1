# Loot Fleet — deploy v231 · build 670 · COLONY PAYS WHAT IT SHOWS · NO PHANTOM FIGHTER BAYS · ONE BADGE NUMBER · TABS COUNT IMMEDIATELY · AUTOPILOT NEVER PARKS · ABANDONED TILES STAY NEUTRAL · KAEVITH FINDABLE AGAIN

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v230. Service worker cache is `lootfleet-v670`.
**Login screen reads `BUILD 670`.**

### NOTHING TO RUN ON THE SERVER FOR THIS RELEASE

**No SQL, no Edge Function redeploy, no cron change.** 670 is entirely client-side
— push the folder and you are done.

One save migration runs itself in the client, guarded by its own flag so it fires
once per account and never again:

| flag | what it does |
|---|---|
| `n.drFix` | rescales live nanocore Damage Reduction rolls by /10, to match the buff's new 0.1–0.5% range |

Two new pieces of state need no migration: `mm.radj` (the moon colony's banked raid
adjustment, defaults to 1) and `state.tileFree` (the 24h neutral grace on a tile you
abandon, self-pruning).

If you are standing up a NEW environment rather than updating the live one, the
server work from build 666 still applies and is listed under "What changed in 666".
**The `social/` folder must ship with the site** — Buffer fetches the post images from `lootfleet.com/social/png/…`.

Carries builds 583–670.

### What changed in 670 — player bug reports

Ten reports, plus a Kaevith rarity review. All client-side.

- **The moon colony paid less than the collect card promised.** `accrueMoon()`
  recomputes `stored` from scratch on every accrual — and the screen's own
  `pending()` accrues on every render — so a raid outcome written INTO `stored`
  survived exactly one tick. A repelled raid showed its +15% in the card and then
  paid the base amount: **389k shown, 338k banked (389 / 1.15), on top of the 7.8k
  already held — the reported 347k almost exactly.** Raid outcomes are now banked in
  `mm.radj` and applied at accrual time, cleared when you collect, so what the card
  shows is what the shipment pays. A breach skim is equally permanent now (it used to
  be refunded by the next tick). Prism can also no longer be dropped on the floor:
  the ingot bag is created on demand instead of being skipped when absent.
- **Fighter bays appeared in cannon slots on most hulls.** Registering `fighter` in
  `WEAPON_CLASSES` put it in the modulus of the legacy-cannon hash, so **1 in 7 old
  cannons resolved to "Fighter Bay"** — name, glyph, colour and projectile. The hash
  now runs over cannon classes only, and a cannon saved with a fighter `wclass` (bays
  were briefly cannon-slot items) falls through to it rather than reading as a launch
  rack. Which slot an item sits in decides what it is.
- **The Starforge offered a Fighter Bay hardpoint on a Dreadnought.** `slotKeys()`
  listed every key present in `state.equipped`, and that map keeps keys from hulls you
  flew before. It reads `CONFIG.shipSlots()` now — the same layout the Hero screen and
  `computeStats` use — so the forge cannot show a hardpoint the hull does not have.
- **Both badge counts were wrong, and they disagreed with each other.** The header
  printed `totalClaimed()` (all 1,110 rendered badges) over a hardcoded 1,000, while
  the Titan Sina card printed the original-ladder count over the 1,110 total: 826/1000
  beside 803/1110, neither being the number of badges held. **By request the capstone
  now counts every rendered badge — claim all 1,110 and the ship is granted** — and one
  count, one whole, is printed everywhere.
- **A completed mission or badge did not light its tab.** The red dot was written only
  by `tabsHtml()`, i.e. only when the VISIBLE board's structure changed, so a weekly
  order completing while you stood on the daily board left that tab bare until you
  tapped it. `patchTabs()` now writes all four dots in place on every tick and on
  every badge sync.
- **The Badges tab flickered.** `ACHIEVE.html()` is 1,110 badge cards plus the Titan
  Sina hero image, and the 1s tick re-`innerHTML`'d all of it. It now has the same
  contract the mission boards have had: `sig()` rebuilds only when the ladder's
  structure moves, `patch()` writes the moving numbers into the live nodes.
- **Autopilot sometimes would not fly.** With an unreachable hostile (outside the world
  box) as the nearest enemy, the operator steered to a **dead stop and returned, every
  tick**, for as long as it stayed nearest — which is why flying manually and re-arming
  cleared it. It now takes the nearest REACHABLE hostile, and with none falls through to
  the spawn-node drift instead of parking.
- **Bots claimed tiles the moment you abandoned them.** The rival sim treats a shielded
  tile as off the board, but abandoning CLEARED the shield — so a bot could take the
  tile on the next 6-minute galaxy tick, or on the next load through `seedRivals()`.
  A released tile now carries 24h of neutral grace that blocks the **sim only**: you and
  real players can retake it immediately.
- **Nanocore buffs retuned.** Damage Reduction 1–5% → **0.1–0.5%** (it is a divisor on
  every hit taken and stacks with the Pilot Tree's Armor, which pays 0.5% a node, so a
  five-slot Legendary was handing out up to 25% flat mitigation). XP Gain floor 2% → 1%,
  so the range has room for a genuinely bad roll. Live DR rolls are rescaled /10 by
  `n.drFix` and keep their relative quality — a god 5% roll is still a god 0.5% roll.
- **The PRO chip opens Pro.** It sits inside the VIP badge but it is a different
  product, and tapping it opened the VIP ladder — there was no route in the game to what
  Pro actually includes. VIP pill → VIP sheet, PRO chip → the Pro sheet.
- **The Pilot Tree was drowning in crit chance.** `critChance` was one of eight
  equally-likely offense rolls paying 1.5–3% a node, while a whole Primordial fitting's
  crit line is ~0.1%. Three in four crit rolls now become another offense stat; ring 1 is
  exempt because those six nodes are the curated opening. Magnitudes are untouched, so no
  node you already own loses value.

### Kaevith Incursion — rarity reviewed (670)

**A winning roll threw.** `xenTechRoll()` returned `pity: pity` with `pity` never
declared — a `ReferenceError` on the one path that matters. The hull was granted and
saved a line earlier, so the ship arrived silently while the caller's claim handling
died with the throw: **winning the event looked like nothing happening.**

**And the odds were too thin to reach.** The Aug 2026 pass cut them 5× (1%/10% →
0.2%/2%) and removed the pity floor at the same time. At 0.2% a pilot working the inner
rings could clear invaded zone after invaded zone for weeks and see nothing.

Rather than lifting the base rate back to where hulls stopped reading as prizes, **the
drought now pays**: base odds go to 0.8% (ring 1) → 5% (rim), and every invaded clear
that misses raises the next roll by 40% of base, capped at 12× (and 75% absolute). A win
resets it. Ring 1 tops out near 9.6%, the rim near 60%. `state.xenDry` already existed
as a debug counter and is the escalator's memory. The tile sheet reads the effective
number through `GAME.xenChanceNow()`, so the odds shown are the odds rolled.

### What changed in 669 — player bug reports

Six reports from the Discord, all fixed. No balance changes, no new content.

- **Weekly mission "Logistics Run" could never progress.** It counts delivered
  manifests off `state.lifeStats.cargo` — a counter nothing in the game had ever
  written, so the mission sat at 0/3 forever while the player kept delivering.
  Cargo Defense now increments it on every successful run. Existing players get a
  one-time backfill from their career win count, and the Tour's live weekly
  baseline is raised by the same amount so the seed cannot hand out a completion
  nobody earned.

- **The Ember Choir was appearing in Prism Mining fields.** A prism run borrows
  the Zone Grind arena and its enemy stream, and `isEmberBossPending()` only
  asked "Zone Grind, no system" — so a Choir-claimed zone reskinned the field boss
  in the middle of a dig. The Choir belongs to zone grinding proper; while a prism
  run is live the zone now fields its ordinary garrison.

- **LootCoins read as an abbreviation.** The HUD chip ran the balance through the
  K/M/B ladder that bulk resources use. LootCoins are spent in exact amounts
  against exact prices, so the balance now prints in full with separators.

- **Kaevith and Choir popups fired with nothing to win.** Killing a Choir hull you
  already own, or clearing an alien zone with all five Kaevith hulls in the
  hangar, still opened a result card to report a roll that could not pay out. Both
  rolls now return nothing and no card is built.

- **Home Citadel frame rate.** `boot()` runs on DOMContentLoaded and again on a
  1.2s safety timer; the HUD tick had no guard, so every session carried two
  one-second intervals. Guarded. The fort's render pass also ignored the LOD
  governor that the rest of the game sheds on — `RENDER.getLOD()` is now exposed
  and the citadel consults it, dropping canvas text, the patrol ring, cargo drones
  and ambient sparks under load. Towers and the fx pass never shed: the defense
  itself always resolves at full fidelity.

- **Tour shards for hulls the Exchange cannot redeem.** The shard pool was a
  hand-kept exclusion list that had drifted from the Shipworks roster, so shards
  dropped toward ten hulls with no part requirement — no Inventory row, no
  Exchange row, no ASSEMBLE. The pool now reads `SHIPWORKS.buildableKeys()`
  directly, so the two lists cannot disagree. Shards already banked against those
  hulls are bought back once at the hull's own salvage rate, with a toast naming
  what was converted; the orphaned keys are cleared from the save.

### What changed in 666

- **EVERY CARRIER IN THE FLEET FLIES ITS WING NOW.** A wing belonged to the
  flagship alone — capacity, bays and rig all read `state.ship` — so a Corvus
  sitting in the fleet fed its stat lines into the hull total and then flew
  nothing. Eleven bays of visible hardware, no craft on screen. Escort carriers
  launch, orbit, target independently and return exactly as the flagship's do,
  **from their own hull position**, out of their **own stowed fittings**
  (`state.fittings[key]`) — so upgrading a benched carrier's bays upgrades that
  carrier's craft.
- **Escort strikes are paid at the fleet share (30%).** An escort's hull mods and
  stowed gear already reach `rt.stats` at `C.FLEET.statShare`, so a full-price
  escort wing would be the same hardware counted twice over. The share keeps a
  benched carrier worth fielding without letting a bench of them out-damage the
  hull actually being flown.
- **Ship Score counts them, each at its share.** `dpsRatio()` sums every wing
  rather than the flagship's — leaving escort wings out would have repeated, one
  level down in the fleet, the exact fault that function exists to fix: a hull
  scored as though its bays were empty. Verified: a cannon Dreadnought flying a
  Vanguard + Corvus bench reports `wingRatio` **1.238**, which is
  `((4/4 + 11/4) × 1.10) × 0.30` to the third decimal.
- Per-wing normalisation, launch fan and stagger are all measured **within** the
  craft's own wing, so one carrier's loadout never rescales another's and an
  escort's craft do not fan out at an angle derived from the flagship's bay count.

### What changed in 664

- **GOOGLE SIGN-IN NO LONGER PUBLISHES YOUR REAL NAME.** `finalizeCloud()` resolved
  the pilot name as `meta.name || meta.full_name || meta.user_name || <email local
  part>` — the person's actual first and last name, or `firstname.lastname` from the
  address. The pilot name is PUBLIC: leaderboards, territory claims, battle reports,
  the Discord feed. Signing in with Google published your legal name to a game
  channel. Provider fields and the email are now never read.
- **New accounts get a generated callsign** — `Voidhawk-417`, `Emberfang-238` —
  derived deterministically from the account id, so one account reads as the same
  pilot on every device before it is renamed (a per-device random name would make
  one player look like several mid-sync). The first-login gate then asks them to
  choose their own, with the field starting EMPTY so it asks a real question rather
  than inviting a blind Enter, and the copy states we never use a real name.
- **Names already leaked are scrubbed.** Established accounts are carrying the
  adopted Google name in the save and on the leaderboard. Where the stored name
  matches what the provider calls that person AND they never chose it themselves
  (no `lf_name`, the key `setName()` writes), it was adopted rather than picked: it
  is replaced with a callsign, the leaderboard row is overwritten, and the naming
  prompt is forced via a `csTemp` flag that overrides the veteran-save skip. A name
  the player DID set is left untouched, even if it is their real one — that was
  their decision to make.

### What changed in 662

- **MOON COLONY WAS BEING WIPED BY ONE LINE IN THE SAVE MERGE, AND PLAYERS ARE
  GETTING THEIR COLONIES BACK.** `mergeSaves()` folded each colony's building map
  with `Math.max(bb[k] | 0, ob[k] | 0)` — but a building is an OBJECT,
  `{ kind, lv }`, and `{...} | 0` is `0`. Every structure in every colony became
  the number zero on any conflicted login. **This is both Moon Colony reports from
  a single line:** before build 653 a numeric entry threw inside render()
  (`B[undefined].ic`) and the screen went blank; 653's shape-repair pass then
  correctly deleted the junk, which converted the blank screen into a wiped colony.
  The merge now folds the objects — higher level wins, `kind` is never lost, and a
  building repaired on either device counts as repaired.
- **Restitution, two tiers, at most once per colony.** `account.js` stashes the
  untouched cloud copy at `lf-backup::<uid>` before every merge, so where that
  snapshot survives the real colony is restored **slot for slot at its true
  levels** — exactly as it was built. Where no snapshot survives, **we do not invent
  a colony.** An earlier cut of this filled the empty slots with plausible mines and
  it read as precisely what it was: random structures the player never placed, at
  levels they never chose. The slots are now left EMPTY and the **build cost is
  refunded** instead — priced off a baseline Ore Mine at a level derived from
  terraform depth (the one development signal the corruption left intact) — so the
  pilot rebuilds their own layout with their own choices, for free. Sectors and
  terraforming were never affected. The in-game mail itemises the refund and says
  plainly why it is a refund rather than a restore.

### What changed in 661

- **GAME SPEED IS HONEST AGAIN — the recurring "AI broke the speed" regression,
  fixed at the root.** A 2m30s Voidmaw run was finishing in 1m18s at 5x. Two
  separate places were throwing sim time away: `dt` was clamped to 50ms (so a
  phone holding 12fps simulated 0.25s per 0.083s frame = 3x, not 5x), and the
  sub-step CEILING (3 or 6) capped it a second time. The 651 "debt bank" did not
  help — it only repaid on a frame FASTER than the cap, and under sustained load
  there is no such frame, so the debt pinned at its ceiling and the overrun was
  deleted regardless. There is no bookkeeping now: the frame's REAL elapsed time
  is always simulated, sub-steps absorb it (ceiling 16, so long frames stay
  granular), and the only bound is a genuine 0.25s stall boundary that
  `computeOffline()` already owns. 5x now means 5x at any frame rate.
- **Voidmaw black holes and their red telegraph are visible again.** The wells
  painted BEFORE the flagship, so on a capital hull — the Voidmaw draws at 2.8x —
  the ship's own aura covered them completely. Hazards now draw in a pass ABOVE
  the whole fleet: anything you have to read and avoid is painted last.
- **Capital-hull auras no longer glare over the arena.** Halo radius keyed off the
  hull footprint (651) so big sprites keep their glow clear of the art, but it was
  unbounded — at 2.8-5.2x it grew into screen-filling light. Bounded at 96px local
  radius, with the prism halo's bloom scaled back to match.

### What changed in 660

- **Shard crates are weighted by the ladder now.** The hull pick was uniform, so
  an apex Titan Sina shard was as common as a Frigate shard. Weight decays 18%
  per rung (floor 1.5): early hulls dominate the haul, an apex shard is ~0.3% a
  crate.

### What changed in 659

- **TOUR OF DUTY IS LAUNCHED — for real this time.** All four beta doors are gone:
  the Command card shows for everyone from Level 1 (no level lock), the screen
  opens, its hulls buy, the toast speaks. No code needed; `LF-TOUR-BETA-ACCESS`
  now redeems as a harmless no-op. Level price stands at 3,000 ◈, prorated.
- **Tour progress is ascension-proof and merge-proof** (verified, not new code):
  `tour` and `tourBeta` sit in ASC_KEEP so a Pilot Ascension carries the whole
  pass across untouched, and the account merge unions xp/own/claim so no device
  or relog can regress it.

### What changed in 656

- **TOUR OF DUTY IS BACK BEHIND THE BETA GATE** — it was launched in 655 and
  re-armed the same day for more testing. All four doors read `state.tourBeta`
  again; `LF-TOUR-BETA-ACCESS` opens them. Season XP still accrues for everyone
  while hidden, so nobody arrives at launch behind.
- **TOUR.setXp(n) console repair + XP correction epoch.** Hard-sets season XP,
  stamps `tour.xf`, drops claim marks above the new level, clamps the overtime
  counter, saves and pushes. The merge honours the NEWER `xf` outright (xp, ov,
  claims), so a downward correction survives conflicted logins instead of the
  old "higher xp wins" rule resurrecting leaked test XP.
- **RENDER LOD GOVERNOR — the ×10 cargo-run slideshow.** Three levels driven by
  smoothed frame time (0 full · 1 trimmed · 2 survival), one step per 0.8s so it
  never flaps. What each level sheds, in cost order: the **full-canvas CSS
  grade** (saturate/contrast/brightness recomposited every frame at device
  resolution — the biggest fixed cost on the screen), the wide under-pass stroke
  of every projectile trail, then at survival: single-stroke trails, no bloom
  halos, no lightning shadowBlur, crit-only floats, and the vignette overlay.
  Float spawn cadence and caps tighten under load. Everything walks back up the
  moment frames recover. The simulation is never touched — only paint.

### What changed in 654

- **ONE MAP ON EVERY DEVICE.** The arena was sized as `viewport × zone multiplier`,
  so the world was as big as the screen it was drawn on — while every gameplay
  distance in the engine is a fixed number of world pixels (fire range 250, loot
  magnet 620, spawn spreads, beacon rings). A phone therefore got a world a third
  the width of a desktop one with the same ranges laid over it: hostiles spawned
  inside magnet range so loot arrived without moving, the same ~55 spawn nodes
  packed into a quarter of the area, and kills per minute ran far higher than on
  desktop. It was not a look-and-feel difference, it was a different farming rate.
  The world is now authored against one reference viewport and has the **same area
  everywhere**, laid out at the screen's own aspect ratio; zoom carries the
  difference, eased out on small screens and bounded so sprites stay legible.
  Desktop is the reference, so desktop is unchanged.
- **A won citadel is now inherited at ONE choke point.** Every path that flips a
  tile — ordinary siege, clone-fleet turf war, Void assault, razing claim — ends
  in `captureSystem()`, and that is where the fortress is inherited now. It used
  to be inherited only in `captureCitadel()`, so a tile won through the generic
  siege path (the common case in My Galaxy: the server row carries the rival's
  citadel but the local waves object never set `playerCit`) handed the winner a
  plain tile and deleted a Rank 5 fortress. Winning a citadel means owning that
  citadel, at the rank it was built to. Captured fortresses ignore the build cap.
- **Moon Colony can no longer show a blank screen.** One bad field anywhere in
  `state.moon` threw inside the renderer and the screen painted nothing. A save
  carrying a building `kind` a later build renamed threw on **every** render,
  which is why it hit established colonies and never fresh ones. Every field the
  renderer reads is now normalised once before it is read (unknown structures are
  dropped, indexes clamped, missing stores rebuilt), the diorama can't take the
  screen with it, and a failed render shows a readable card with the reason.
- **Damage reduction now actually applies, and is capped at 20%.** It was applied
  BEFORE the 22%-of-max-hull one-shot clamp, so at endgame — where hits land far
  above that — the clamp threw the reduced number away and re-imposed the same
  22%: DR measured as zero, exactly as reported. It now reduces the clamped
  figure, so it always removes its full share of what you actually take. Ceiling
  is 20% (`DR_CAP_PCT`), and Pilot Tree / skill nodes drop to **0.5% per node**
  (Armor and Damage Reduction 1.5–3% → 0.5%, Aegis Lattice 6% → 0.5%, Resolve
  1% → 0.5%).
- **XP RATE: the stack was right, one screen was lying.** Ship Ascension's Combat
  Computer still advertised +0.5% XP per level after the August cut to +0.35%, so
  a pilot with 175 levels counted 87.5% and was paid 61.25% — the whole 26.3-point
  gap in the 658.1% vs 631.8% report. The screen now quotes what it pays.
- **Kaevith copy matches the hulls.** The Incursion briefing computed its stack
  total from the roster instead of the retired `+250%` (it is **+160%**), the
  Splinter's blurb quoted 10% for an 8% hull, and the Godshard no longer claims to
  double XP — it says +64%.
- **TOUR OF DUTY — buy the level you are standing in.** 3,000 ◈ for a full level,
  **prorated against progress already made**: at 40/100 XP the rest costs 1,800 ◈.
  Bought XP goes through the same award path as earned XP.
- **TOUR OF DUTY — past 100 it is "100+" and the crates stack.** Levels 101–125
  were 25 ladder rows and then a hard stop, which capped a pilot who bought levels
  at 25 crates no matter what they spent. Now every 100 XP past 100 is one more
  fitting crate, they stack, they are opened in one tap, and there is no ceiling.
  The season's own XP still funds exactly 25 of them (12,560 earned vs 12,400 for
  level 125), so nothing about earning the pass changed.
- **CARGO DEFENSE: frame rate is now the first constraint.** The run held up to
  ~42 live hostiles, 26 collapsing rings and a dozen anomalies at up to 5× — all
  numbers set for fairness, none of which asked whether the device could draw
  them. The run now measures its own frame time and holds a load level (1.0 →
  0.35) that scales the hostile ceiling, ring cap and anomaly cap live, walking
  down on slow frames and back up on recovery. Alongside it: sub-steps capped at 3
  during a run (it is hand-flown, so latency beats sub-step smoothness), the
  particle budget halved, and the portrait canvas dropped to 12Hz. The run still
  lasts ten minutes and the boss still arrives — nothing is skipped.
- **The battle screen survives tabbing away.** iOS Safari hands the canvas back
  with its CSS box intact but the drawing buffer still at the size it had while
  hidden, and it changes the device pixel ratio under us; either one painted the
  arena into one small corner and left the rest of the element blank. The fit
  guard now checks the **backing store and the DPR**, not just the CSS box,
  re-fits on `visualViewport` / `pageshow` / rotation, refuses to re-fit to 0×0
  while hidden, and the frame clears to deep space instead of transparent (which
  is what showed as white).
- **XP and combat no longer lose time off the battle screen.** The 50ms frame
  clamp was throwing the overrun away, so every long frame — a menu doing DOM
  work, iOS at 30fps, a hot phone — silently deleted sim time, multiplied by five
  at 5×. The overrun is now banked as debt and paid back, bounded at 1.5s.
- **Discord shows art for EVERY hull.** Only Kaevith hulls ever had a sprite,
  because `log_xen_hull()` was the only acquisition anyone reported to the server
  and it whitelists the five xen keys; the leaderboard-count route needs art
  columns that competing `lb_upsert` overloads keep dropping. `log_hull()` is the
  same reliable path widened to every hull, reported from the one choke point both
  acquisition paths already call. Idempotent per pilot per hull, xen keys refused
  (they keep their louder card), and the count-based card stands down for anyone
  the reliable path covered.
- **Prism aura is visible on a Dreadnaught.** Every halo sized itself from hull
  tier alone, so on a sprite drawn 2–3× larger the ring sat inside the artwork.
  Radii now take the larger of the tier figure and the hull's real footprint.
- **Coupon redemption marks now survive save merges** — `redeemedCodes` joins the
  merge union (it was decided wholesale by the base pick, so a stale copy winning
  a conflicted login re-armed every one-time code, including this giveaway).
- **New coupon: `LF-DISCORD-UNVEIL`** — +1,000 ◈, one redemption per account, for
  the redesigned Discord server.

---

## ⚠ TOUR OF DUTY IS DARK IN THIS RELEASE

The season pass is LIVE for every player from Level 1 as of build 666 — no gate,
no code. `LF-TOUR-BETA-ACCESS` remains redeemable as a no-op.

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 670 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `670` |
| Update beacon | `version.json` → `build` | `670` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v670` |
| Project root beacon | root `version.json` (source tree) | `670` |

Root `sw.js` is NOT a stamp — it is the kill-switch worker for the old poisoned
origin and stays un-versioned. Verified un-versioned at cut time.

### Folder audit — all green

| check | result |
|---|---|
| js/css files `game.html` references | **74** |
| stale vs project root | **0** |
| missing from folder | **0** |
| references without `?v=` | **0** |
| references carrying `?v=583` | **4** (`web-v89.css`, `readability.css`, `entities.js`, `ui-v94.js`) |
| references carrying `?v=587` | **3** (`game-v93.js`, `cargo-defense.js`, `ranks-boards.js`) |
| references carrying `?v=588` | **1** (`nanocores.js`) |
| references carrying `?v=590` | **1** (`account.js`) |
| references carrying `?v=594` | **2** (`cloud.js`, `server-dreadnaught.js`) |
| references carrying `?v=595` | **3** (`fighters.js`, `items.js`, `render.js`) |

| references carrying `?v=597` | **4** (`ui-v94.js`, `missions.js`, `ranks-boards.js`, `cargo-defense.js`) + `mail.js` |
| references carrying `?v=598` | **1** (`render.js`) |
| references carrying `?v=599` | **4** (`fighters.js`, `items.js`, `game-v93.js`, `ui-v94.js`) |
| references carrying `?v=602` | **1** (`fighters.js`) |
| references carrying `?v=603` | **1** (`items.js`) |
| references carrying `?v=604` | **6** (`game-v93.js`, `config-v2.js`, `pilot-ascension.js`, `nanocores.js`, `ascension.js`, `dreadnaught.js`) + `pilot-ascension.css` |
| references carrying `?v=605` | **2** (`render.js`, `leaderboard.js`) |
| references carrying `?v=606` | **1** (`ship-panels.js`) |
| references carrying `?v=607` | **2** (`game-v93.js`, `pilot-ascension.js`) |
| references carrying `?v=609` | **2** (`ui-v94.js`, `config-v2.js`) |
| new files | `js/fighters.js`, `ships/ship-vanguard.png`, `ships/fighter-heavy.png` |
| `game.html` byte-identical to project root | **yes** |

Seeded from `deploy-v226`, then `js/`, `css/`, `guides/` and `supabase/` deleted
and re-copied from the project root as separate calls (never a bulk copy over
patched files — the v216 failure), then all 74 referenced files byte-compared.

Files changed: `js/game-v93.js`, `js/entities.js`, `js/ui-v94.js`,
`js/nanocores.js`, `js/account.js`, `js/cloud.js`, `js/server-dreadnaught.js`,
`js/fighters.js` (new), `js/items.js`, `js/config-v2.js`, `js/render.js`,
`js/cargo-defense.js`, `js/mail.js`, `js/missions.js`, `js/ranks-boards.js`,
`js/pilot-ascension.js`, `js/nanocores.js`, `js/ascension.js`, `js/dreadnaught.js`,
`js/leaderboard.js`, `css/pilot-ascension.css`, `guides/XP-CHANGES-604.md`, `css/web-v89.css`,
`css/readability.css`, `supabase/functions/discord-feed/index.ts`.

**Re-cut eight times** — 584 Home Citadel XP, 585 Void Zone XP, 586 Void/casino
loot, 587 the Discord game-art feed, 588 the Nanocores level gate removed, 589
the nanocore wipe, 590 the equipped-core repair narrowed, 591 the art fields
actually reaching the table, 592 the art rung made self-healing, 593 the Voidmaw
score rollback, 594 that repair reaching pilots outside the top 100, 595 the
Fighter Carrier class, 596 the Vanguard filed under Carrier, 597 the Cargo gate
and citadel capture, 598 the Vanguard performance pass and sprite aspect fix, 599
Fighter Bay as a real equipment slot, 600 the fighter damage pass, 601 fighter
marques and the bonus audit, 602 the envelope cap, 603 carriers delivered with a
wing, 604 the XP rebalance and the weekly ascension ceiling, 605 the Ships-tab
hardening, 606 the XP copy and the UTC raise label, 607 the Dread Praetorian, 608 the
hardpoint chips, 609 the Titan Aquila, 610 the portrait-art fix, 611–613 the
server-synced ascension countdown, 614 the Celestial Corvus and the LootCoin payout
pass, 615 the unreleased-badge order, 616 the save-merge audit. All four stamps are
617 the epoch guard, 618 the shared gradient def and a STALE ui-v94 reference,
619 the Tour of Duty season pass, 620 the Tour hull routes, 621–631 the reward
clarity work, the Tour UX rebuild and the per-level pills, 633–638 the Tour's own mission boards, one canonical LootCoin icon, the track CTAs, Admiralty at 50,000 ◈, and the fighter DPS rebalance. All four stamps are at 645. If you pushed this folder at 583–626,
push it again.

**New files:** `js/season-pass.js`, `css/season-pass.css` (both referenced in
`game.html`).

**New file:** `js/servertime.js` (loaded in `game.html` right after
`config.live.js`). **New assets:** `ships/ship-praetorian.png`,
`ships/ship-titanaquila.png`, `ships/ship-corvus.png`. **New SQL:**
`supabase/server-now.sql` (optional but recommended — see §33).

**New assets:** `ships/ship-praetorian.png` (609: background removed and trimmed —
re-copy it even if you already pushed 607) and `ships/ship-titanaquila.png` (new in
609). Confirm both copied.

---

## THE SEQUENCE

1. **Supabase → SQL Editor → run `supabase/discord-art-publish.sql`.** Safe to
   re-run. Adds the three nullable columns, **drops every existing `lb_upsert`
   overload and installs exactly one** carrying the art params. Superset of
   `discord-art-fields.sql` — run this one and skip that file. **Without it every
   card posts with no art**, because the values are discarded at the RPC.
   **Read the verify block at the bottom: it must report exactly ONE `lb_upsert`.**
2. **Deploy the `discord-feed` Edge Function** from `supabase/functions/discord-feed`.
3. **Push this folder** to the repo root and let Vercel build.
4. **Then** confirm `version.json` reads 587 at the live URL.

Steps 1–2 are safe to run before the push: an old client publishes nothing into
the new columns, and the feed posts those cards without art rather than failing.
Doing them after the push is also fine — the feed just stays art-less until then.

The SQL drops EVERY `lb_upsert` overload and installs one. That is deliberate,
and it fixes a second live fault found while diagnosing the missing art: a
catalogue check returned **three** overloads, two of them re-declaring
`p_power`/`p_kills` as `bigint`. `bignum-power-fix.sql` had widened those to
`numeric` because endgame fleet power passes 1e29 — 25 billion times the bigint
ceiling — but `cargo-ladder.sql` and `nanocore-ladder.sql` ran afterwards and
each declared bigint afresh. `create or replace` cannot replace a function whose
argument TYPES differ, so each ADDED a copy beside the widened one. The ceiling
was back on the rung the client tries first, `cloud.js` treats a 22P02 as a hard
failure rather than a degrade, and `isLegacy()` does not recognise ambiguity
(PGRST203) either — so a high-power pilot's publish was being abandoned for the
tick. The new function is numeric where numeric belongs.

Clients on build 590 and below keep publishing through the same function — their
calls omit the three new params, which default to null and leave the columns
alone.

**If you ever re-run `cargo-ladder.sql` or `nanocore-ladder.sql`, they add a
bigint overload back. Run `discord-art-publish.sql` again afterwards.**

The beacon ships inside the folder, so the order is automatic — but if you push
the beacon by hand ahead of the files, connected players are evicted onto code
that is not live yet. Don't.

The update gate evicts every connected player within ~90 seconds of the push.

---

## What changed

### 1 · Ship frozen in boss zones — auto AND manual (the big one)

Two separate faults stacked into one symptom.

**The joystick was hidden while the game forced manual flight.** The stick is
only shown when `getAuto()` is false, and that check ran from `UI.syncAuto()`,
which was never exported on `window.UI`. The Voidmaw, alliance raids and the
cargo escort all call `setAuto(false)` directly to enforce manual flight — so
they flipped the mode and left the control surface hidden. No stick, no autopilot:
the ship did not move on either setting. It cleared itself as soon as anything
else happened to call `syncAuto()`, which is the reported intermittency ("every
3–4 times you jump into a boss dungeon it locks in"). `setAuto()` now notifies
the UI on every change.

**The autopilot could chase a target it was physically unable to reach.** The
player hull is clamped to the arena every frame; enemies were not. Given a
hostile outside those bounds the autopilot flew into the wall and held there at
full throttle — visually dead still. It now ignores any target outside the world.

### 2 · The Void Citadel could be pushed off the map

`Enemy.update()`'s station-keeping term was pure geometry with no reference to
the hull's own `speed`, so a `speed:0` hull still got a real push out of its
hold ring. The Void Citadel is exactly that hull. Closing inside its ring shoved
the fortress backwards, the autopilot chased it, and the pair walked each other
clean out of the zone — where a siege objective is unkillable and the zone can
never be completed.

Station-keeping is now capped by the hull's own speed, so a fortress genuinely
cannot move. **And enemies are clamped to the arena** — they were the only mover
in the game without a world clamp, which is what let this become unrecoverable
rather than merely annoying.

### 3 · Owned Dread hulls read as unowned in Nanocores

`shipUnlocked()` answers "can progress reach this hull?" — Nanocores was using it
as "do I own this hull?". Dread Harbinger, Tyrant and Omega gate on level
160/180/200, all **above the 150 level cap**, so after the season reset every
Dread hull a player owned disappeared from the MY HULLS filter. Award-only hulls
(Voidmaw, Eternum) returned false by design and had the same problem.

Ownership is checked first now. The buy path is unaffected — `shipBuyState()`
already returns `owned` before it ever consults this.

This is also the most likely source of the Dread-screen crash in the same report,
which was intermittent and not reproducible on demand. If it recurs, the console
line at the moment it happens will pin it.

### 4 · Home Citadel defense paid XP — removed entirely

Fort defense sets raider HP from the pilot's **own DPS**
(`run.unitHp = ps.dps * (55 + wave * 4.5) / run.N`), so every raider is built to
die on schedule however strong you get — and auto-chain rolls wave into wave with
no ceiling. That is an XP faucet that scales *with* the player instead of
resisting them: park in the fort and out-level the whole zone grind without ever
flying a zone.

Home defense kills now pay **zero XP**, gated at the same point in `onKill()`
that already excludes cargo escort runs for the same reason. Everything else is
untouched — the wave payout (gold, ore, fuel, plasma, part crates, Dread Cores)
is unchanged, and so is kill gold, loot and resource scavenge. The reward for
defending the fort is the payout, not levels.

### 5 · Void Zone and casino tiles paid rewards priced for zones nobody earned

A Void tile deploys you at **its level requirement × 1.5**. The Lv 500
Singularity is `currentDungeon = 750`; the Lv 100 Hollow Throne is zone 150. Every
reward priced off the zone number is therefore priced far above anything the
pilot actually reached. Two rewards were: XP and fittings.

**XP (585).** `killXpFor()` pays on the zone it is handed, so a pilot barely past
the gate farmed XP at a zone they could not survive for real — the same fault the
cargo-escort carve-out already existed to stop.

**Fittings (586).** `I.generate(750)` rolls gear on the inflated zone, with the
rarity cap and quality curve to match. It out-geared the grind exactly the way it
out-levelled it.

Both now pay **zero** in Void and casino tiles, across every door:

| door | XP | fittings |
|---|---|---|
| live kills (`onKill`) | 0 | 0 |
| boss / warden kills (`bossLoot`) | 0 | 0 (resource bounty still pays) |
| citadel razed (`citadelDown`) | — | 0 (resource bounty still pays) |
| Fracture Zone bonus drop | — | 0 |
| **offline progress** (`computeOffline`) | 0 | 0 |

The offline door mattered most: it simulates kills against `state.currentDungeon`,
so parking on a Void tile and closing the tab was the easiest abuse of the set and
would have survived a fix to live kills alone.

This also covers the **casino House Citadels**, which are `void: true` tiles
carrying the identical ×1.5 inflation — same exploit, same mechanism. If you want
the casino holds paying again, that is a one-line carve-out.

Void tiles keep everything that makes them worth taking: hourly income on all four
currencies at ×25, the free fixed citadel, **kill gold**, **Galaxy Resources**,
the resource bounties, and the Warden of the Void badge. The prize is income and
conquest, not levels and gear.

### 6 · Discord feed now posts real game art

The feed could see that a COUNT went up — hulls, Legendary Nanocores, deliveries —
but not *what* changed, so it had nothing to hang art on and fell back to stock
GIFs. Three published fields close that, and one derivation needed no field at all.

**New hull earned** — a brand new card. Every hull, cheap ones included: a
pilot's second ship matters to them as much as a Dread does to someone deep, and
the art is the whole point. Fires on the `ships` count rising; `hull_last` names
it and picks `ships/ship-<key>.png`. Sits between `dread` and `cargo` in the
embed priority.

**Legendary Nanocore** — the existing card now carries the sprite of the hull the
core was recovered for, as a thumbnail, plus a line naming it. A core belongs to a
specific ship; that detail is what makes it read as a real pull instead of a
counter ticking. The celebration GIF stays as the hero image on a first pull.

**Tile takeover** — every claim, steal and release now states where it happened:
ring, axial coordinates and one of six named sextants, plus the ring's level band
and a deep-space warning past ring 18. **This needed no new column.** Tile ids are
literally `q,r`, and the feed already mirrors the client's deterministic tile
generator, so position is derived server-side from the id.

**Cargo deliveries** — tier 3 and up now post **every** delivery, led by that
tier's real freighter art (`ships/cargo-<tier>.png`). Tiers 1–2 keep the old rule
(first delivery and milestone counts only) so the quiet road runs stay quiet.

**Void spires** — the seized/claimed card gains the actual citadel art for that
tier, banded the way the game bands it (`VOID_ART`): 25/50 → 1, 100/200 → 2,
300/400 → 3, 500 → 4.

**Art first, GIF as fallback.** Discord fetches the URL itself, so a dead file
can't be detected server-side — it just renders without the image. The rule is
therefore about knowledge, not liveness: when the card has a specific subject
(this hull, this freighter, this spire) it points at that subject's art; when the
subject is a mood rather than an object (a throne changing hands, a siege
repelled) there is nothing to photograph and the GIF stays.

**The trap this avoids.** The cargo and Nanocore milestones shipped once before
and never posted, because the migrations ran and the client published but the
SELECT never asked for the columns — every read came back `undefined` and scored
zero on both sides of the diff. `LB_ART` is a new top rung on the existing
degrade ladder and it asks for `ships`, `hull_last`, `nano_last` and
`cargo_tier` by name. `ships` was never in the select either, which is why a
hull card was not merely missing art — it could not have existed.

### 7 · Nanocores no longer needs Level 50

The system was gated at Level 50 for no mechanical reason: its currency is Prism
Ingots, which a pilot can bank from events, the alliance store or the moon colony
long before 50, and the crates that drop cores were never level-gated either.
So the gate blocked spending on the one system whose cost is a resource the
player already had.

`NANO.unlocked()` now returns true unconditionally, and `CFG.gate.level` is 0.
Every consumer already asks through that one function, so the screen, the Crates
sub-tab, the mission list and the combat/fleet stat feeds all open together.

Cores still cost ingots, and slots still cost successful upgrades — nothing about
the economy changed, only who is allowed to enter it.

**One thing to know:** the Nanocores screen's **GET CORES** button routes to the
Crates console, which is still gated at Level 20 by its earliest tab. Below 20 a
new pilot can equip and manage cores they already hold but cannot reach the crate
that sells them. Say the word if Crates should open at 1 too.

### 8 · "All my nanocores are gone" — the save merge was losing the bag

Two reports, no examples, both guessing at ascension. Ascension is not the cause,
but it is the trigger.

`mergeSaves()` picks ONE copy of a save as the base and then unions specific
fields in from the other — entitlements, Pro time, owned hulls, pilot level,
ascension points and perks, Voidmaw's daily figures, cosmetics, the lifetime
tallies. Every system that has ever regressed got a line in that list. **`nano`
never did.** So the whole bag — cores, unlocked slots, rolled buffs, dupes — rode
inside whichever copy won the pick, and the losing copy's cores went to the
conflict quarantine with it. Nothing else on the account changed, which is exactly
what both players described.

`saveWeight()` does count cores, so the intent was there, but the term is far too
small to matter: a 30-core bag scores about 5K, against 7,200 per decade of gold
and 5,000,000 per ascension star. It can never flip the pick. The fix is not a
heavier weight — it is making the pick unable to lose cores at all.

**Why it looks like ascension.** Ascending is the one moment a save legitimately
gets *lighter* — level to 1, gold to 0, zone to 1 — so the base pick stops being
decided by weight and falls to the star tiebreak. It is also when players relog
and switch devices. A pilot who bought cores, ascended, then logged in somewhere
else hit every condition at once. `pilotAscend()` itself has always kept the bag:
`nano` is in `ASC_KEEP` and is restored explicitly.

**The union now runs field by field**, in the same idiom as the Voidmaw block:

- **Cores** merge per hull-and-rarity id. Where both timelines hold the same core,
  the DEEPER one wins — slots first, then stage, the order ingots were spent in.
  A core is taken **whole**: buff arrays are never blended, because rerolls and
  locks are choices and mixing two timelines' rolls would hand back a core neither
  one ever had.
- **Dupes** take the max per rarity. They are a 10:1 exchange balance, so in
  principle two offline devices could spend the same ten twice — bounded, minor,
  and better than eating dupes the player earned.
- **`opened`** takes the max.
- **Equipped cores** are repaired: filled in from the other copy, then anything
  pointing at a core that did not survive is dropped, then the strongest surviving
  core is seeded on any hull **still** empty. An adopted core that is not switched
  on pays nothing, which would have read as a partial wipe.

  The repair never touches a hull that already has a core equipped (590). The
  first cut let the rarity preference run on every hull, so a pilot who had
  deliberately equipped a deep Epic over a fresh Legendary would have had that
  choice overwritten on every single login — the same "my cores changed by
  themselves" report this build exists to end. Rarity is not the only power axis:
  five ingot-funded upgrades per slot go into one specific core, and the buff pool
  carries Multi Shot, Crit Damage and XP Gain at real magnitudes.
- **`lifeStats`** takes the max per key. These are strictly monotonic (`bumpLife`
  only adds) and they are what badges, missions and the Discord feed read — they
  had the identical wholesale-loss problem, and a lost pick un-earned badges that
  had already been posted to Discord.

**This does not recover the two players' cores.** The merge only stops it
happening again. Their losing timeline was stashed at
`lf-conflict::<uid>` / `lf-backup::<uid>` in that device's localStorage — if
either still has the browser they lost them in, that copy may still hold the bag.
Do not restore currency from those snapshots (they predate resets); the `nano`
object alone is safe to lift.

### 9 · The art fields never reached the table (591)

The first NEW HULL card in the channel posted with **no sprite** and the title
"took delivery of **the a new hull**". Everything upstream was right:

- `discord-art-fields.sql` had added `hull_last`, `nano_last`, `cargo_tier`
- the client computed all three (`ranks-boards.js` → `publishLb`)
- the feed asked for them by name (`LB_ART`) and got the columns back

They were dropped at the last boundary. `lb_upsert` enumerates its parameters,
and the widest overload — 18 args, from `nanocore-ladder.sql` — has no
`p_hull_last`, `p_nano_last` or `p_cargo_tier`. PostgREST discarded all three,
so every row carried an empty `hull_last` forever.

**This is the same trap as the missing SELECT, one layer down.** The read was
fixed and the write never was. That the card FIRED at all is the proof the read
works: `ships` only exists in `LB_ART`, so a hull card is impossible unless that
select succeeded — which means the columns exist and the value was empty.

Four parts:

- **`supabase/discord-art-publish.sql`** — new migration. Drops every `lb_upsert`
  overload and installs one carrying the three params. An empty string never
  clears a stored value: a client publishes every 90 seconds and only one of those
  follows a hull purchase, so overwriting with `''` would blank the key before the
  feed's next 2-minute tick — exactly the race that produces an art-less card.
- **The same migration fixes the bigint regression** described in THE SEQUENCE:
  three overloads were live, two of them re-narrowing `power`/`kills` to bigint
  after `bignum-power-fix.sql` had widened them. Endgame power passes 1e29, so
  that ceiling silently abandoned high-power pilots' publishes.
- **`js/cloud.js`** — a new top rung on the degrade ladder sends the three
  params, with its own `_lbNoArt` flag and 6-hour re-arm, so a server that has
  not run the migration keeps publishing every other ladder untouched.
- **The feed's copy** — `hullName('')` returns the phrase "a new hull", which
  cannot take an article. The title and the line now have a named and an unnamed
  form, so a row with no key still reads correctly.

`FEED_VER` is now **592**, tracking the client build (was 570 — never bumped when the art code
shipped). That number is echoed in every response, so
`select content from net._http_response order by created desc limit 3;` proves
which build of the function is actually live.

### 10 · The art rung backed off for six hours (592)

Shipping 591 exposed an ordering trap. Every rung of `cloud.js`'s publish ladder
degrades for **six hours** when the server rejects it, which is right for the
others — a missing migration is a standing fact about that server. It is wrong for
the rung being rolled out right now, where the rejection almost always means "the
SQL has not run yet" or "PostgREST has not reloaded its schema cache yet". Both
are minutes.

The effect: a browser open while the old 18-arg function was still live tried the
art rung once, got "function not found", and kept publishing without the art
fields for six hours — long after the SQL was correct. Only a page reload cleared
it, and only if the schema reload had happened FIRST, or the flag just set itself
again.

Now: **5-minute retry** on the art rung (the others keep six hours), a one-time
console warning naming the migration and the `notify pgrst` command, and
`CLOUD.lbState()` to read which rungs are degraded and when each re-arms:

    CLOUD.lbState()
    → { art: {off:true, retryIn:212}, nano: {off:false, retryIn:0}, … }

So the deploy no longer has an order requirement. Run the SQL whenever; every
client picks the art fields up within five minutes on its own.

### 11 · Voidmaw score rolls back after a relog (593)

Two screenshots a minute apart, before and after a relog. The DAILY board went
YOU 998Qa #3 → YOU 2.01T #6; SEASON went YOU 998Qa #6 → YOU 2.01T #9. **Every
other row on both boards is identical between the two shots** — same seven names,
same seven figures, same order.

That asymmetry is the diagnosis. The YOU row is the only row drawn from LOCAL
state (`meDay = s.bestDay`, `meSea = Math.floor(s.total)`); every rival row comes
from `sdread_scores`, and `cloudOthers()` filters the player's own uid out of the
server list before rendering. So the board is telling you the local save rolled
back while the server did not.

The server row cannot regress — `sdread_upsert` is ratcheted with `greatest()`
inside a season and day, and a live run publishes every 15 seconds. **His real
score is on the board for everyone else. His own client is the only thing showing
the old number.**

Why the save rolled back: a finished run reaches localStorage through
`ACCOUNT.push()`, which returns BEFORE `saveLocal()` for a kicked tab or a tab
that never claimed the session lock; `saveLocal()` itself swallows a quota
failure; and the cloud flush is debounced 8 seconds. A relog inside that window
leaves neither copy holding the run, and `mergeSaves()` cannot defend a value that
is in neither copy.

**Fix: the account's own server row is now a floor for the local record.** After
every board fetch, `reconcileFromServer()` raises `bestDay`, `total` and
`bestStage` to the server's figures if they are higher, then saves. It only ever
raises, so an unpublished fresh run is untouched, and the row can only contain
values this same account sent under its own uid. `best_day` is adopted only when
the row's own `day` column is today — at the UTC rollover `sd()` has already
zeroed `bestDay`, and adopting yesterday's figure would re-place the pilot on a
board he has not fought on yet.

**The row is fetched by `user_id` (594), not scanned out of the board.** Both
boards are `limit(100)` and the season board spans the whole season, so a pilot
ranked 101+ is simply absent from the array — reading the floor out of it would
have made the entire repair inert for everyone outside the top 100, which is most
of the players it exists for. `CLOUD.sdMine(season)` selects the single row by id;
`ensureCloud()` fetches it alongside the two boards.

`flushPublish()` had the same latent assumption: scanning the top-100 daily slice
cannot tell "no row of mine" from "my row is rank 101", so a mid-table pilot
republished on every event-screen open. It now reads the same direct row, and
falls back to the slice only until that fetch lands.

Frosty does not need to do anything to recover: opening the event on 593 pulls his
real figures back within one fetch.

**Also fixed:** the mid-run publish sent `Math.max(s.bestDay | 0, …)`. `| 0`
truncates to 32 bits, and daily bests are past 1e17 — so the stored best was
garbage on that comparison. Harmless in practice (the server takes the max anyway)
but wrong, and it is now `+s.bestDay || 0`.

### 12 · FIGHTER CARRIERS — a new hull family and a new equipment class (595)

A carrier archetype whose damage leaves the ship. Built as a **reusable
equipment class**, not a one-off: the Vanguard is simply its first hull.

**Fighter Class is a WEAPON CLASS.** `fighter` is registered in `items.js`
alongside Pulse Lasers and Warden Arrays, so a squadron is an ordinary
Cannon-slot item and inherits the entire existing pipeline — it drops from
anything, rolls every rarity, carries normal stat lines, rerolls, salvages,
sells, auto-equips and saves with no new code on any of those paths. Nothing
about fighters is hardcoded to one hull.

**Compatibility is one function, both directions.** `canMountWeapon()` already
kept Warden Arrays on the Aegis; it now also refuses a Fighter Bay on any hull
without launch capacity, **and refuses every cannon on a Fighter Carrier**. One
choke point, so every equip path — manual, auto-equip, escort fitting,
auto-sell's "does the fleet need this" check — obeys it for free.

**The Vanguard** (side-branch like the Aegis, so the upgrade ladder is
untouched). It files in the **Carrier** tab and keeps `cls:'Carrier'` — the
hangar buckets by `cls`, and `cls` also picks escort weapon type and hull
accent, so a launch bay could never be a class string. `fighterCapacity` is the
real signal and every fighter rule tests it, which is the same convention that
keeps the Dread hulls in the Carrier bucket. `canMountWeapon()` therefore takes
a ship **key** rather than a class name (596).

| | |
|---|---|
| Fighter Bay | 1 · **no cannon at all** |
| Munitions | none |
| Hull slots | 2 |
| Utility (boots/gloves/shield core) | **none** — new `noUtility` ship flag |
| Drone bay | none |
| Fleet escorts | yes |
| Speed | **`speedMult: 0.25`** — a flat quarter of the reference hull |
| Capacity | `fighterCapacity: 4` |
| Unlock | Blueprint (5% from a Lv80+ Void Citadel) → 24,000 kills → 200M gold + resources |

`speedMult` multiplies the finished `moveSpeedPx` rather than adding a
`moveSpeed` mod, so "75% slower than the reference hull" stays exactly that
whatever else stacks speed, and can never drive the value negative.

**The craft are not projectiles.** `js/fighters.js` gives each one a state, a
target, a position and a velocity, and it steers itself:

    DOCKED → LAUNCHING → INTERCEPTING → ORBITING → (target dies) RETARGETING
           → INTERCEPTING → … → (nothing in range) RETURNING → DOCKED

- **Targeting spreads before it stacks.** A target already being worked is only
  chosen when every target is — four craft on four enemies, not four on one.
- **The envelope is measured from the CARRIER**, not the craft, so a fighter
  cannot wander past the edge of it just because something was in reach when it
  launched. That is what makes parking the ship the whole skill.
- **Retargeting does not go home first.** A fighter whose target dies picks the
  next one and flies straight there.
- **Recall is a flight, not a despawn.** With nothing in range the wing flies
  back and stows; a docked craft rides the hull exactly rather than loitering.
- **Damage goes through `resolveHit()`** — the same path a bolt takes — so
  crits, life steal, boss and elite multipliers, kills, XP and loot all resolve
  normally with nothing duplicated.

**Built to extend.** Capacity is a ship stat, never a constant, so a 6-, 8- or
12-bay carrier is one config line. Every other number is in `CONFIG.FIGHTER`
(damage share, attack rate, envelope, speed, orbit radius, launch timing) or
scales off the bay's rarity via `ITEMS.fighterSpec()` — rarity makes a squadron
hit harder, cycle faster and reach further, but **never launches more craft**, so
a bay can't out-scale the hull carrying it.

**Art** is cut from the supplied render: `ships/ship-vanguard.png` (hull) and
`ships/fighter-heavy.png` (the craft), separated by connected-component analysis
rather than by hand.

**Two known gaps, both deliberate for a first cut:** the Hangar still labels the
bay slot "Cannon" (the slot name is global), and a Vanguard flown as a fleet
ESCORT fires ordinary escort bolts rather than launching — escorts run their own
simplified combat path. Say the word on either.

### 13 · Cargo Defense opens at ★3 (597)

`UNLOCK_STARS` 20 → **3**. The event was priced for pilots deep into prestige;
it now opens shortly after the first ascension. One constant drives the screen,
the lock panel, the mission list and the Command card, so nothing else needed
changing — the sim-pilot generator's haulage threshold moved with it
(`ranks-boards.js`) so simulated rivals stay believable against the new gate.

### 14 · A sieged citadel changes hands INTACT (597)

Winning a citadel siege in My Galaxy used to hand the winner the fortress **one
rank lower**. That quietly made a citadel worth attacking and never worth
building: Rank 5 is four rank-ups of fuel, iron and plasma on top of the build
cost, and the pilot who paid for all of it handed the winner a Rank 4.

Now the fortress transfers **whole** — same rank, same output, same defence
multiplier. Take a Rank 5 citadel and you own a Rank 5 citadel.

- `captureCitadel()` drops the `- 1`; an unknown rank still resolves to Rank 1,
  and the result is clamped to `CITADEL_LV_MAX`.
- The captured rank is what gets republished to `territory` (`citadelLv`,
  `fleetScore`), so the next attacker faces the fortress at its real strength
  rather than a stale one.
- Wording followed the mechanic: the siege prompt and the wave HUD read **TAKE
  THE CITADEL** rather than RAZE when the defender is a player's fortress (the
  Zone Grind's NPC Void Citadel is a different encounter and still says raze),
  and the war-report mail now says the citadel was taken intact instead of
  reduced to rubble.

No SQL: `citadel_lv` already carries whatever rank the client publishes.

### 15 · Every ship sprite was being stretched (598)

Ship art is not square. It runs from near-square up to **176×512** (the
Vanguard), and every draw site fed it into a `ds × ds` box — so the hull was
squashed to fit. Near-square art hid it; the Vanguard made it obvious.

Three layers had it, and fixing only the outer one would not have helped:

- `drawArcher`, `drawEscort` and the hangar all called
  `drawImage(img, -ds/2, -ds/2, ds, ds)`. They now scale the sprite's real
  dimensions to fit the box on its longer axis.
- `lvlTint()` built a **square** canvas and drew the sprite stretched into it,
  so any hull at upgrade Lv3+ was pre-squashed before it ever reached the draw
  call.
- `skinnedShip()` did the same for every non-stock skin.

Both caches now **letterbox**: the canvas stays square, so the stripe geometry
inside the skins and every existing call site keep working untouched, but the
sprite sits centred at its true aspect instead of stretched to fill.

This affects **every hull in the game**, not just the Vanguard — tall hulls that
have always looked slightly wrong will now read correctly.

### 16 · The Vanguard was laggy (598)

Four causes, all in the wing:

- **`shipSlots()` ran every frame.** The equipped-bay lookup called it to find
  which slot the bay sat in, and it builds three slices and a concat on every
  call. The rig (capacity, bay item, resolved spec) is now cached and re-resolved
  on a 0.4s timer — a fitting change that lands 0.4s late is imperceptible.
- **`ctx.shadowBlur` on every attack frame.** Blur re-rasterises the whole
  sprite; four craft firing at 2.6/s meant it was on for roughly a third of all
  frames. The muzzle glow is an additive dot now.
- **The engine trail used a per-frame random.** `Math.random() < dt * 22`
  saturates to *one mote per craft per frame* once `dt` is large — which is
  exactly what happens at 5–10× game speed. It is a fixed game-time cadence with
  a hard particle budget now.
- **Per-frame garbage.** `_fx()` returned a fresh object literal twice a frame,
  the target list was reallocated every frame, a `Map` was built every frame, and
  target validity was an `indexOf` scan per craft. The loop now allocates nothing:
  one reused bridge object, one reused target array, an integer stamp written on
  the enemy for O(1) validity, and one reused damage packet.

Under load the wing also fires **half as often for double damage** — identical
DPS, half the floating numbers — which is the same rule the drone bay already
uses.

### 17 · Every fleet benefit now reaches the fighters (598)

The wing was only reading damage and crit. It now inherits the lot:

- **Life steal** already worked (`resolveHit` never gated it on drone fire).
- **Cryo, Starforge freeze and the Voidmaw singularity** did NOT: all three are
  gated on `!p.drone`, and fighter hits were flagged as drone fire. The flag is
  gone — a fighter is the hull's entire weapon, so every fleet proc has to fire
  from it.
- **Multi-Shot** is rolled per attack against nearby hostiles, exactly as
  `fire()` rolls it for a cannon. It is held back while the frame is already
  crowded so it can never be the thing that drops it.
- **Attack speed folds into fighter DAMAGE rather than rate** — the same trade
  the hull's own "meaty fire" rule makes past 2.2 shots/sec. The wing carries
  endgame fire-rate bonuses without adding one object to the frame.

**Fighter sprites are 2× larger** (`drawSize` 26 → 52).

### 18 · FIGHTER BAY is a real equipment slot (599)

The first cut smuggled fighters in as a Cannon-class item, which meant the
Hangar labelled a launch bay "Cannon" and a hull's capacity had nothing to do
with how many slots it showed. Fighter Bay is now a **first-class slot**
alongside Cannon, Munitions and Hull.

**`fighterCapacity` IS the bay count.** The Vanguard declares 4, so it exposes
**four Fighter Bay slots** and flies four craft. `shipSlots()` emits
`BAY_SLOTS.slice(0, fighterCapacity)`, so capacity and slot count cannot drift
apart, and an 8-bay carrier is still one config line. The Vanguard now declares
`weapons: 0` — it has no cannon hardpoint to refuse, which makes "a Fighter
Carrier mounts no cannon" structural instead of a rule.

**One bay, one craft.** Each fighter's damage, cadence, reach and speed come from
the item in ITS bay. Upgrade one bay and exactly that craft gets better; leave a
bay empty and it flies nothing. A half-fitted carrier flies a half-strength wing.

**Rarity drives DPS twice.** The bay's own damage line is what that craft hits
for, and the item also feeds the hull's stat total the way every fitting does.

**They drop on the normal loot table.** Being in `CONFIG.SLOTS` is what does it —
`generate()` picks a slot at random from `SLOT_KEYS`, so bays drop from anything,
at every rarity, with normal stat lines. `fighter` was removed from the cannon
class-weight table at the same time: a bow can no longer roll it, because it is
not a cannon class any more.

The item chip, tooltip and comparison panel all recognise the slot, so a bay
shows its class icon and blurb like a cannon does.

### 19 · Fighters hit far harder (600)

`FIGHTER.dmgFrac` **0.42 → 0.95**, a touch over 2× per strike.

Single-target throughput is the whole point of the class. A cannon hull spends
its damage across a screen — multi-shot spread, splash, a drone screen — while a
fighter wing puts four craft on what is in front of it and grinds it down. At
0.95 a four-bay wing lands roughly **9.9× attackDamage per second** before crit
and Multi-Shot, against about **2.2×** for a cannon hull's base fire.

The carrier pays for that everywhere else: quarter speed, no munitions slots, no
utility slots, no drone bay, and a short envelope it has to be flown into.

One constant, read by every craft — tune it in `CONFIG.FIGHTER`.

### 20 · FIGHTER MARQUES — bays have classes now (601)

A cannon rolls a class: Pulse Laser gives attack speed, Gatling gives Multi-Shot,
Plasma gives life steal. Bays rolled nothing — every one was identical apart from
its rarity. Five **marques** fix that, and they go further than a cannon class
does, because a fighter is a thing that *flies* rather than a bolt that travels:
a marque carries a signature stat **and reshapes the craft** — speed, cadence,
per-strike damage, orbit radius and the carrier's envelope.

| Marque | Signature | The craft |
|---|---|---|
| **Talon Interceptor** | +Crit Chance | Fastest in a bay, tight orbit, quick cycle, light hits |
| **Maul Gunship** | +Crit Damage | Slow and heavy — 1.75× per strike at 0.7× cadence |
| **Lance Strike Wing** | +Engagement Range | Envelope and orbit **+55%** |
| **Reaper Wing** | +Life Steal | No flight edge; keeps a hull that cannot run away alive |
| **Swarm Vector** | +Multi-Shot | 1.5× cadence at 0.62× weight — every per-hit effect procs far more |

`rateMul × dmgMul` is held near 1.0 across the set, so a marque is a **shape,
not a power level**. Rarity is still the power axis and multiplies on top.

They are held in a separate array from the cannon classes on purpose:
`weaponClassOf()` hash-resolves legacy cannons by indexing that array, so a
marque sitting in it would eventually be handed to a bow. A bay that dropped
before 601 resolves to the generic entry rather than falling through that hash.

### 21 · Bonus audit — what reaches the wing (601)

Walked every source of combat stats against the fighter path.

**Already reaching it** (all of these feed `rt.stats`, and a fighter's strike
resolves through the same `resolveHit()` a bolt does): skill tree, **pilot tree**
(`DREAD.combatMods`), hull mods, Ship Ascension, nanocores, Starforge tempers,
hull upgrade levels, fleet-escort stat share and the Warden aura — via attack
damage, crit chance, crit damage, Multi-Shot and life steal. Boss and elite
multipliers (`DREAD.dmgVs`, `PASCEND.mult('boss')`), Monolith siege bonuses,
FrostyFrost cryo, Starforge freeze and the Voidmaw singularity all fire from
fighter hits. Attack speed folds into fighter damage.

**One real gap, now closed: WEAPON RANGE.** Skills, the pilot tree, hull mods,
gear and the Warden aura all extend `fireRange` — and every one of them was
reaching a cannon and nothing else. A Fighter Carrier's reach **is** its
engagement envelope, so a range build did literally nothing for the whole class.
`refreshStats()` now publishes `s.rangeMul` (the same multiplier `fireRange` is
built from) and the envelope scales on it — **damped and capped** (602).

Passing it through raw was wrong: endgame `fireRange` runs 15,000+ against a 250
base, so a `rangeMul` of 61 turned a 620-unit envelope into ~37,000 — around
twenty times the whole map. That deletes the pillar the class is balanced on,
makes `speedMult: 0.25` free, and makes the Lance marque's identity meaningless,
since +55% of a map-covering number is still map-covering. It also undid part of
the 598 perf pass, because the target scan then matched every living enemy every
frame. `FIGHTER.rangeShare` (0.12) and `FIGHTER.rangeMulCap` (1.35) keep a range
build worth having — a plain bay goes 620 → 837 — while the deepest reach in the
game lands just under the map diagonal instead of dwarfing it.

**Deliberately not shared:** hull HP, regen and damage reduction (the carrier's,
not the craft's), and move speed — fighter speed belongs to the marque and the
bay's rarity, and the Vanguard's `speedMult: 0.25` would otherwise crawl the wing
along with the hull.

### 22 · A Fighter Carrier is delivered with its wing (603)

Every other hull in the game can be flown the moment you own it. A bare Fighter
Carrier could not: with no bay fitted it has **literally no weapon** — no cannon
hardpoint to fall back on and no craft to launch — so a player who ground 24,000
kills and 200M gold for a Vanguard got a ship that could not fight.

`grantShip()` now fills every bay with a **Common** fighter. Common on purpose:
it is the floor, not a gift, and the whole progression of the class is replacing
them with better marques and rarities. They roll at the pilot's current depth so
the stat lines are honest for where they are, and only EMPTY bays are filled, so
it can never overwrite a fitting.

`ITEMS.generate()` gained an optional `forceSlot` for this — a carrier being
handed a known fitting cannot roll a random slot for it.

Carriers granted before 603 are filled once on load (`state.fbaySeed`), same
Common floor, so nobody is left holding a hull that cannot shoot.

### 23 · XP: the cap leak, and a game-wide reduction (604)

**The bug.** The formula was `total = base × (1 + Σ bonuses / 100)` with
`base = 500` on Pro. It reads as additive but it is not — the base MULTIPLIES the
summed bonuses, so on Pro **every +1% a pilot earned was worth +5 points of
rate**. A Pro member with a maxed Neural Uplink (+200%) sat at 500 × 3 = **1500%**,
i.e. 500 points past the 1000% cap, and every node, VIP level and Kaevith hull
bought after that did nothing at all. That is the reported "bonuses stack past the
cap" — they did, and the overflow was silently discarded. It also made the cap
trivial: Pro's own base spent half of it before a single bonus.

**The new formula — one sum, nothing multiplies anything.**

```
rate% = 100  +  400 (if Pro)  +  min(500, Σ every other bonus)      cap 1000
```

The three numbers line up deliberately: **100 + 400 + 500 = 1000**, so the ceiling
is exactly "base, plus Pro, plus every bonus maxed" and nothing a pilot earns is
ever thrown away. Non-Pro maxed is 600%.

**Pro's headline is untouched.** 100 + 400 = 500% = the advertised 5× XP. What it
no longer does is quintuple everything else.

**Every source was also cut at its definition**, so a maxed account sums near
+400 rather than +600 — the cap is a backstop, not a routine:

| Source | Was | Now |
|---|---|---|
| Neural Uplink, per rank | +8% | **+5%** (+125% at rank 25) |
| Kaevith hulls, full set | +250% | **+160%** (8/16/28/44/64) |
| Nanocore XP buff | 3–10% | **2–6%** |
| Combat Computer, per step | +0.5% | **+0.35%** |
| Pilot Tree XP node | 4–8% | **3–5%** |
| VIP 15 | +60% | +60% (untouched — loyalty ladder, not a stack) |

`xpFleetInfo()` keeps every field its consumers read and adds `bonusPct`,
`bonusCapped` and `bonusCap`, so the hero chip and the My Ship pill can say which
ceiling is biting. Player-facing copy is in `guides/XP-CHANGES-604.md`.

### 24 · The ascension star ceiling — weekly, self-running (604)

**`cap = 10 + 7 × (whole weeks since Mon 10 Aug 2026 00:00 UTC)`**

No server, no config push, no dev action, ever. It is arithmetic on `Date.now()`,
so it raises itself every Monday for as long as the game exists and keeps raising
if nobody touches the file again. UTC throughout, so the raise is the same instant
worldwide. The epoch is the Monday BEFORE this shipped, so week 0 is the launch
week (cap ★10) and the first raise is the following Monday (★17).

Enforced in two places, because a ceiling that only exists in the UI is not a
ceiling: `preview().eligible` now requires `stars < starCap()`, and
`ascendFlow()` refuses at the cap with a toast (the flow is also reachable from
the gate toast).

The Ascend tab gained a **THIS WEEK'S STAR CEILING** card, above the calculator:
three stops (where you are → this week's cap → next week's), a progress bar, the
raise weekday and a live countdown, and a sentence stating the whole mechanic. The
hero line and the locked-state copy both switch to cap language when you are at
it, so "why can't I ascend" is answered before it is asked.
`PASCEND.starCap/starsLeft/atStarCap/nextCap/nextRaiseAt/untilRaise/capWeeks` are
exposed for any other screen that wants them.

### 25 · Ships-tab hardening (605)

Chasing reports of crashes on the Ships page. The roster itself renders clean here
on a full account and on a simulated new one, so the cause is not reproducible
from source — these are the real defects found while looking, plus a containment
guard:

- **The three showcase hulls loaded eagerly.** Every other ship image carries
  `loading="lazy"`; the Titan Sina / Aeternum / Eternum art did not — and
  `ship-eternum.png` is **1536×1024**, about 6 MB decoded on its own. On a
  low-memory phone, decoding that plus 43 more sprites on one screen is a
  plausible tab kill. Now lazy.
- **`shipRoster()` is wrapped.** It walks all 44 hulls reading live account state
  (owned, blueprints, upgrade level, build progress, licence). A throw anywhere in
  that walk took the whole Hangar down and left no route back; the tab now renders
  with an inline notice instead.
- **`lvlTint()` could cache a 1×1 hull (regression from 598).** `srcW/srcH` fall
  back to 1 for an image that has not decoded, so a tint built too early was a
  single pixel — and it was cached, so that hull stayed one pixel for the rest of
  the session. The old `img.width || 96` masked it by guessing. It now returns the
  original and caches nothing until the art is decoded.
- **Rival loadouts were rolling Fighter Bays.** `loadoutFor()` tested
  `!eq[it.slot]`, and a slot the loadout does not model reads `undefined` —
  also falsy — so a rolled bay was added as a seventh key and counted as filled.
  Board pilots displayed a launch bay on hulls that cannot mount one. Now
  `=== null`, and the grid only renders slots the loadout models.
- **Offline auto-equip bypassed mount rules.** `computeOffline()` assigned
  `state.equipped[it.slot]` blind, so an offline-found Fighter Bay landed in
  `equipped.fighter` on a hull with no bay and its stat lines counted for free.
  It now checks the hull's real slots and `canMountWeapon()`.

**Still open:** if the crash persists, we need the device and whether it is the
Ships list itself or a hull's detail sheet — the roster is clean, so the next
suspect is memory on a specific device.

### 26 · XP copy caught up with the formula (606)

604 changed the maths and left the two in-game explanations describing the removed
behaviour — the hero chip and the My Ship pill both still said "**bonuses add
together, then multiply the base**", which is exactly the bug, and quoted bonuses
as "**% of base**" (2% of a 500 base reads as +10 → 510, while the chip beside it
correctly showed 502). Both now state one sum, name Pro as +400 flat, and describe
bonuses as flat percentage points.

Both consumers are also wired to `bonusCapped` / `bonusCap` now. They previously
branched only on `capped` (the 1000% total), so a pilot whose bonuses passed +500
was clipped with no indication — the same silent overflow this work exists to end.
The pill now names WHICH ceiling is biting, and `headroom` is reported against the
bonus ceiling, which is the one a pilot walks into by buying perks.

**The cap card named the wrong day west of Greenwich.** `raiseDateText()` used
`toLocaleDateString` with no `timeZone`, so the Mon 00:00 **UTC** boundary
formatted in local time: the label read "Sunday, Aug 16" under a sentence
promising "+7 every Monday" — for every player in the Americas. It now formats in
UTC and says so, and the body copy states "every Monday (00:00 UTC)". The
countdown was always timezone-proof.

### 27 · DREAD PRAETORIAN — the apex hull (607)

**Dread-class Fighter Carrier.** The highest-performing Dread hull in the game and
the only one that is both gunship and carrier: **4 cannon hardpoints AND 6 fighter
bays**, on top of full Dread-class munitions, plating and utility fittings.
**Nineteen fitted slots** — more than anything else flies.

```
bow ×4 · fighter ×6 · arrows ×3 · armor ×3 · boots · gloves · amulet
```

This is the hull the Fighter Bay system was built to make possible. The Vanguard
trades every cannon away for four bays; the Praetorian gives up nothing, which is
why it sits above the Omega rather than beside it. Every stat line is **1.15× the
Dread Omega** (hp 3040%, dmg 1710%, multi-shot 456, crit 90/1330, atk speed 570%,
range 910%, life steal 16.8%, 96 drone bays).

No code changes were needed to let it mount both: `canMountWeapon()` has keyed off
`fighterCapacity` rather than a class string since 596, and refuses cannons only
where there is no cannon hardpoint to begin with (the Vanguard's `weapons: 0`). A
hull with both simply has both.

It keeps `cls:'Carrier'` — the hangar files by `cls`, and `cls` also picks escort
weapon type and hull accent. The **Dread** tier bucket used to pick on `megaCost`
alone, which dropped a costless Dread hull in beside the Super Carrier; it now also
matches a `DREAD-CLASS` tag.

### 28 · `unreleased` — a finished hull with no route yet (607)

Both fighter hulls are **not obtainable**, by request. The Vanguard's blueprint
drop and build order are removed; the Praetorian never had one.

A hull with no `price`, no `megaCost` and no `build` is dangerous, not inert: it
reads as "unlocked and affordable" and hands itself over for free. Three guards:

- `awardOnly()` in `game-v93.js` gained `unreleased` — the same list that already
  protects the Celestial, mission and event hulls from exactly this. `shipBuyState`
  now reports `unlocked: false`.
- The Hangar card has an explicit `unreleased` branch **first** in the
  action/lock chain, because everything downstream guesses a route from
  price/megaCost/build/blueprint and would have rendered a "$ 0" buy button.
- The tile badge reads **◈ SOON**, and the blueprint-chip fallthrough skips it.

Both hulls are fully implemented and fly correctly the moment one is granted —
only the acquisition route is missing. Adding one later is a config line.

### 29 · Hardpoint chips name the fighter bays (608)

The chip row under every hull was a fixed four: `⚔ cannons · ⊕ munitions ·
⛨ hull · ◎ drones`. It predates a hull having zero cannons or any fighter bays at
all, so the Vanguard read **"⚔0 ⊕0 ⛨2"** — a broken ship rather than a carrier
that trades every gun for four launch bays, and the one thing that defines the
class was invisible.

One helper, `hardpointChips(ship, mode)`, now feeds all five sites (both ship
cards, both tile variants, the detail sheet's Hardpoints row):

```
⚔ cannons · ▲ fighter bays · ⊕ munitions · ⛨ hull · ◎ drone bays
```

**A zero is never printed** (hull excepted — every hull has one), and every chip
carries a title. The Vanguard now reads **▲4 ⛨2**; the Praetorian reads
**⚔4 ▲6 ⊕3 ⛨3 ◎96**.

The fleet-panel chips needed nothing — they were already driven by
`C.SLOTS[slotBase(sk)]`, which has known Fighter Bay since 599.

### 30 · Praetorian art: background removed (608)

The supplied art was a 1024×1535 PNG on **opaque white** — it would have flown
with a white box around it, and at ~6 MB decoded it was the second-largest sprite
in the game.

Cut by **flood fill from the borders**, not a global white key: the hull is
white-grey plating with near-white highlights, so keying every bright pixel
punches holes through the ship. Only background connected to the edge is removed.
The silhouette is then feathered — a hard alpha step leaves a one-pixel white
fringe that reads as a halo over the starfield — trimmed to the artwork, and scaled
to **460×700**, in line with the other capital hulls.

Trimming also matters for `render.js`: the letterbox fit added in 598 scales on
the longer side of the *canvas*, so a wide empty margin would have drawn the hull
smaller than every other ship.

### 31 · TITAN AQUILA — the apex carrier (609)

**Titan-class Fighter Carrier.** One more cannon and one more bay than the Dread
Praetorian: **5 cannons, 7 fighter bays**, over full Dread-class munitions, plating
and utility fittings and 128 drone bays. **Twenty-one fitted slots** — the most in
the game.

```
bow ×5 · fighter ×7 · arrows ×3 · armor ×3 · boots · gloves · amulet
```

The fighter line now reads as a ladder where each rung adds a bay **and** a gun, so
the wing grows with the hull rather than replacing it:

| Hull | Class | Cannons | Bays |
|---|---|---|---|
| Vanguard | Carrier | 0 | 4 |
| Dread Praetorian | Dread | 4 | 6 |
| **Titan Aquila** | **Titan** | **5** | **7** |

Every line is 1.2× the Titan Sina, which makes it the strongest hull in the galaxy
on paper. It fires the Sina's full-spectrum tracers (`sinaTracers`) and carries the
Dread aura.

`fighterCapacity: 7` was the only thing needed to fly seven craft — bay count and
slot count are the same number by construction (`shipSlots` slices `BAY_SLOTS`),
and `fighters.js` has read capacity as a ship stat since the first build. **No code
changed to support it.**

Two UI matches were needed:

- The **Titan** tier picked on `s.key === 'titansina'`, a hardcoded key, which
  dropped a second Titan hull into plain Carrier. It now also matches a `TITAN`
  tag, and the tier blurb distinguishes the two (Sina = pure gunship, Aquila = apex
  carrier).
- The **full-row showcase tile** was likewise keyed to three specific hulls, so a
  Titan-class ship would have rendered as a 3-up thumbnail. The Aquila joins it
  with its own chip (`TITAN CLASS · CARRIER`) and callout (`FIVE CANNONS · SEVEN
  FIGHTER BAYS · 21 FITTED SLOTS`), reusing the Sina's tracer beams.

**Not obtainable yet**, same as the other two fighter hulls — see §28. Art cut the
same way as the Praetorian (border flood fill, feathered, trimmed) to **522×780**,
a Titan-class footprint above the Praetorian's 700.

### 32 · CELESTIAL CORVUS — the end of the line (614)

**Celestial-class Fighter Carrier.** Four more bays than the Aquila and no more
guns: **5 cannons, 11 fighter bays**, 192 drone bays, full Celestial plating.
**Twenty-five fitted slots.**

And it is **slow**: `speedMult: 0.45`, the only line on its sheet that goes down.
It is the largest vessel in the game and moves like it. Note this is a multiplier
applied after the `moveSpeed` mod, so a movement build still helps — it just never
makes the Corvus quick. Same mechanism as the Vanguard's 0.25.

| Hull | Class | Cannons | Bays | Speed |
|---|---|---|---|---|
| Vanguard | Carrier | 0 | 4 | ×0.25 |
| Dread Praetorian | Dread | 4 | 6 | full |
| Titan Aquila | Titan | 5 | 7 | full |
| **Celestial Corvus** | **Celestial** | **5** | **11** | **×0.45** |

`BAY_SLOTS` was widened 8 → 12 (it was the only hard ceiling in the fighter
system). Beyond that, no engine work: bay count IS slot count, and `fighters.js`
has read capacity as a ship stat since the first build.

The **Celestial** tier picked on `s.key === 'eternum'` — the third time a hardcoded
key would have dropped a new apex hull into plain Carrier (after Dread in 607 and
Titan in 609). It now matches the `CELESTIAL` tag, as the other two do.

### 33 · The ascension countdown is server-synced (611–613)

A weekly ceiling read off `Date.now()` is not a schedule, it is a suggestion:
setting a phone ten weeks forward hands out ten weeks of ceiling. **js/servertime.js**
(new) makes the ceiling honest.

- **Anchor:** `server_now()`, a one-line Postgres function
  (`supabase/server-now.sql`), with the `Date` response header as a fallback. The
  header is the reason the migration is **recommended, not required** — by spec
  `Date` is not CORS-safelisted, but Supabase exposes it, so the fallback works
  today. The function is worth running anyway: the header carries whole seconds,
  the function is microsecond-precise.
- **The clock that ticks is `performance.now()`, not `Date.now()`.** It is
  monotonic and measured from page load, so once an anchor lands, changing the
  device clock mid-session does nothing at all.
- **With no anchor, time does not advance past what the server last confirmed.**
  The highest server instant ever seen is persisted and an unverified session is
  clamped to it, so an offline ceiling freezes rather than inflating. It is a floor
  too, so winding the clock backward is equally inert.
- **It cannot brick ascension.** The gate requires a clock that is *usable*, not
  *verified* — true once one sync has been attempted, whatever the outcome. A
  backend without the migration, or a player with no signal, still ascends; the
  card just says which clock it is on ("server time · synced" / "held at the last
  confirmed week" / "device clock — not yet verified"). A soft ceiling is a balance
  problem; a hard block on a permanent progression action is a support incident.
- **Every ascension is stamped** with the trusted time and a `srv` flag
  (`pasc.hist[]`), so an unverified ladder is auditable after the fact.

The card gained a live countdown that **ticks every second** (`★N unlocks in
1d 03h 27m`), a bar showing how far through the current UTC week you are, and it
re-renders the whole tab the moment the boundary crosses. One interval for the
module, and it stops itself when the node leaves the DOM.

**Honest limit:** this is client code. Someone with devtools can set any value in
their own memory. What it does is make the attack require code injection rather
than the Settings app, and keep honest players correct across timezones, DST and
stale tabs.

### 34 · LootCoin payouts halved across the game (614)

Every LootCoin **reward** cut by 50%. Prices, costs and purchase packs untouched —
only what the game hands out.

| Source | Was | Now |
|---|---|---|
| Mission boards (22 missions) | 5–45 each | **3–23** |
| Mission "all boards clear" bonus ×2 | 100 | **50** |
| Badge grades (Bronze→Titan) | 1–800 | **1–400** |
| Alliance contracts (7) | 20–120 | **10–60** |
| Voidmaw daily ladder | 25/15/10/5 | **13/8/5/3** |
| Voidmaw season ladder | 250/100/50/25 | **125/50/25/13** |
| Cargo manifest LC line | ×0.10 | **×0.05** |
| Discord join bonus | 1,000 | **500** |
| New-account founder grant | 500 | **250** |

Cut at the **table definitions**, not the payout sites, so every multiplier
downstream follows — `scaleRw()` multiplies the mission POOL values rather than
replacing them, so daily, weekly and monthly all halve from one edit.

Bronze stays at 1: it is already the floor and a 0 reads as a broken reward.
Voidmaw **Event Coins were deliberately left alone** — they are event-store
currency, not LootCoins.

**Not touched, on purpose:** the real-money packs in `payments-v91.js` (a price,
not a reward), and the redeem-code / secret-vault grants in `redeem.js` and
`ui-v94.js` (promo and debug paths, not gameplay payouts). Say the word if you want
those halved too.

### 35 · `unreleased` now wins BOTH chains (615)

The Corvus tile read **"✦ Cargo Defense"** instead of ◈ SOON — it carries
`celestial: true` (that flag drives its tier, aura and plating), and `celestial`
sat two checks above `unreleased` in `tileBadge()`. So the tile told players to
grind an event for a hull that cannot drop.

`unreleased` moved to the **top** of `tileBadge()`, immediately after
`if (owned)`, and to the **head** of the ship-card action/lock chain. Every other
branch in both chains names a way to GET the hull; `unreleased` is the statement
that no way exists, so it has to beat all of them rather than only `build` and
`megaCost`. Ordering it last happened to work for the Praetorian and the Aquila
because their only route flags were those two — first is the rule that keeps
holding for the next hull.

### 36 · SAVE-MERGE AUDIT: built progress was being dropped (616)

`mergeSaves()` unioned **entitlements** — hulls, blueprints, purchases, cosmetics,
nanocores, lifetime counters, the ascension record — but nothing the pilot **built**.
These were all decided WHOLESALE by the base pick, so the losing copy's version was
simply gone:

`shipLevels` · `ascension` · `shipKills` · `pilot` · `forge` · `moon` · `prism`
· `achieve` · `ownedSystems` · `citadels`

That contradicted two written promises: this function's own stated rule ("KEPT is
anything you BUILT") and the Pilot Ascension screen, which tells players "every
hull, every hull upgrade level, and every Ship Ascension" survives.

**And the base pick cannot protect them.** One ascension star is 5e6 of weight, so
a fleet-wide difference of dozens of hull levels sits deep inside the ×1.3 tie band
and loses to a stale `lastSave` — the identical shape as the level-regression bug
already documented a few lines above it.

Every value now unioned is **monotonic by construction** (only ever rises through
play, nothing refunds it), so `Math.max` is exact rather than a guess, and merging
twice produces the same numbers. Verified live: a newer-but-poorer copy merged
against a rich one now keeps hull Lv 14, a t6/s5 Ship Ascension module, 500K hull
kills, both Pilot Tree nodes, forge +7, the badge claim, moon mine 8 / 3 sectors,
refinery 4, and the **Rank 5 citadel** — while wallets correctly stay with base.
Idempotent on re-merge.

Notable specifics:

- **Ship Ascension modules are taken WHOLE** — tier, then stars, then level — the
  same rule the nanocore merge uses, so a high tier can never be paired with the
  other copy's star count (a state the game cannot produce).
- **`shipKills` regressions could RE-LOCK a hull**, since `reqKills` gates unlocks.
- **Unioning `achieve.claimed` is what PREVENTS a double payout** — the claim map is
  the only thing stopping a badge rank paying its LootCoins twice, so a lost claim
  was a repeatable reward, not just a lost badge.
- **A lost citadel merge could silently demolish a Rank 5 fortress** — five
  build-and-rank-up cycles of fuel, iron and plasma. Especially bad since §14 made
  a sieged citadel transfer intact at full rank.
- **The Pilot Tree is the one judgement call.** Node ranks are unioned but Dread
  Cores are not, so two devices spending offline into different nodes can leave a
  pilot with marginally more tree than they paid for. That is the same bounded,
  one-time, non-repeating trade the `pasc` block makes ("keep the perks, record the
  debt"), and it is the right way round: losing an entire Pilot Tree to a stale
  login is unrecoverable, one extra node is not.

**Deliberately still base-only:** `gold`, `credits`, `resources`, `dreadCores` and
Prism `ingots`. Those are spendable wallets, and maxing a wallet against a copy that
has not spent yet is exactly the duplication bug the `pasc.pts` block exists to
undo. Same for `forge` `heat`/`pur`/`rr` (live state for one forge attempt) and
`moon.stored` (uncollected output).

### 37 · Duplicate SVG gradient id (616)

The LootCoin icon is injected dozens of times per screen and every copy declared
`<linearGradient id="lcg">`, so the document held dozens of elements sharing one id
— invalid, and browsers resolve `url(#lcg)` against the **first** match, which makes
every icon silently share one definition. Each instance now mints a unique id.
Verified: zero duplicate ids in the live DOM.

### 38 · A STALE CACHE-BUST REFERENCE (618)

`game.html` was serving **`js/ui-v94.js?v=611`** while the file had been edited at
615, 616 and 617. The stamp edits used literal find-and-replace on `?v=615` /
`?v=616`, which were not present — so each one **silently did nothing** and the
reference sat six builds behind. Players would have been served whatever was cached
at that URL: no badge fix, no hardpoint chips, no icon change.

Stamping now goes through a regex helper that **throws when a file has no reference**
rather than no-opping. Worth reading as a general rule for this repo: `replaceText`
is literal, so any stamp step that cannot find its target fails silently, and the
project notes' warning about players keeping stale copies is exactly this failure.

Full audit of every `?v=` in `game.html` afterwards: `ui-v94.js` was the only stale
one, and no file is referenced twice.

### 39 · Duplicate gradient id, properly fixed (618)

616 minted a unique id per `_lcIcon()` call. That is the wrong shape: any caller
that stores the result and interpolates it twice reintroduces the collision, and the
hero coin still hardcoded `lcg3` — a number the counter hands out later. Live check
found `lcg2` on two elements with `url(#lcg2)` resolving ambiguously.

Now **one shared `<linearGradient id="lf-lcg">`**, injected once into the document,
referenced by every icon. That is the actual SVG pattern for this: duplicates become
impossible rather than unlikely, and the page holds one gradient instead of dozens.

### 40 · TOUR OF DUTY — the season pass (619)

**Season 1: THE LONG WATCH.** 8 weeks, 100 levels at 100 XP each, three stacking
columns: **ENLISTED** (free) · **COMMISSIONED** (5,000 ◈) · **ADMIRALTY** (50,000 ◈).
Command menu ▸ first card. Named tracks rather than free/premium/elite so it reads
as one ladder at three weights instead of three products.

**The XP budget is the design.** Verified live, exactly:

| Source | XP |
|---|---|
| Daily board 160 × 56 | 8,960 |
| Weekly board 300 × 8 | 2,400 |
| 12 seasonal challenges × 95 | 1,140 |
| **Total** | **12,500 = 125 levels** |

Which lands all three pacing promises: **3 weeks of daily play → level 43** (so the
Vanguard sits at 40), **90% daily activity → level 107** (so the Praetorian at 100 is
secured by near-daily rather than perfect play), **everything → 125**. Dailies alone
top out near 90 — weeklies are what close the last stretch, deliberately.

LootCoin totals land exactly on **1,000 / 2,500 / 15,000** (ten cells of 100 at
×1, ×2.5, ×15 — which reproduces the brief's own worked example at level 10).
One reward kind per level, never two adjacent, and resources never adjacent to each
other. L40 hull / 3× shard / 5× shard · L50 +1% / +2.5% / +5% XP (all stacking) ·
L100 3× shard / 5× shard / **Dread Praetorian** · L101–125 one item crate each, on
the free track only since the cell is identical on all three.

**Two economy notes, flagged rather than silently "fixed":**

1. **Resource cells are a percentage of held stock**, as briefed. Taken literally
   that rewards hoarding, pays a pilot who just spent nothing at all, and scales
   without limit at endgame. Each payout is **floored** against a level-scaled
   baseline and **capped** at 40× it. The headline is still "% of what you have".
2. **The three tracks pay 18,500 ◈ in total**, which is a lot next to a game whose
   every other payout was halved in 614 — and 15,000 of it comes back from a 25,000
   purchase, a 60% rebate that competes with pack sales. Numbers are as briefed; the
   constants are all in one block.

Also worth knowing: **challenges credit retroactively**, so a veteran account banks
whatever it already qualifies for the first time it opens the screen. Correct
behaviour, but old and new accounts will experience a season opening very differently.

Implementation notes: season XP is awarded **by board, not by mission** — hooked to
the Commander's Crate, the one event meaning "this board is finished", and TOUR
latches its own day/week index so a double call cannot pay twice. The level-50 XP
buff joins `xpSources()` as ordinary additive percentage points, so it answers to the
same cap as everything else, and only **claimed** cells count. Shards ride
`state.shipParts`, the field the Season 1 event hull already uses, so 100 shards
assembling a hull needs no new machinery. Season close settles on the **trusted
clock** (§33) and itemises every outstanding reward into the mailbox.

### 41 · The two Tour hulls named the wrong contract (620)

The Vanguard and Praetorian still carried `unreleased: true`, so the Hangar told
players "**it cannot be bought, built or earned at any price**" — while the Tour
ladder handed the Vanguard out at level 40 and the Praetorian at 100. The Praetorian
is the entire stated reason to buy the Admiralty track.

This is §35 inverted: then a tile named a route that did not exist, now one denied a
route that does. **Root cause:** `unreleased` was one flag doing two jobs — "no
route exists" and "render copy saying so" — and the ladder made the first half false.

Both hulls now carry **`tour: { lv, track }`** instead. The badge reads
**✦ Tour of Duty**, the card names the level and the track and offers a button
through to the screen, and `tour` joins `awardOnly()` so the sale guard still holds
(a price:0 hull otherwise reads as unlocked and affordable and hands itself over
free — verified: `buyShip('praetorian')` refuses with `reason: "award"`, and
`shipBuyState().unlocked` is `false`). `unreleased` stays on the **Titan Aquila** and
**Celestial Corvus**, which genuinely have no route.

`.mc-tour` also had no stylesheet rule, so the new command card rendered as a bare
icon box while its styled siblings carry accents. Defined in `css/season-pass.css`.

### 42 · Every Tour reward now states what you get (621)

A cell reading **"1% gold"** tells a player nothing: the percentage is of a base they
cannot see, through a floor and a cap they cannot see either. Three changes, all the
same principle — name the thing, not the rule.

**Cells lead with the amount.** Every cell shows the figure it will actually pay,
computed live for that account, with the rule demoted to a small second line:

```
Lv3    14K / 1% fuel      71K / 5% fuel      142K / 10% fuel
Lv10   100 / LootCoins    250 / LootCoins    1.5K / LootCoins
Lv40   HULL / Vanguard    3× / hull shards   5× / hull shards
Lv50   +1% / XP forever   +2.5% / XP forever  +5% / XP forever
Lv100  3× / hull shards  5× / hull shards   HULL / Dread Praetorian
```

Resource figures move with your holdings, so they are a live readout rather than a
promise — which is the honest way to show a percentage-of-held reward.

**A WHAT EACH REWARD IS card** states all six kinds once, with this account's real
numbers: what a crate contains and which zone it rolls at, that 100 shards assembles
a hull, that the XP buff is permanent and stacks to +8.5%, and that resources are a
share of what you hold when you claim — including the floor and the 40× cap, stated
plainly instead of hidden. It closes with the stacking rule and the worked example
(1 + 3 + 5 = 9 crates).

**Claiming shows a receipt.** Crates named only "claimed" were the same defect as a
cell named only "1%". Every claim now opens a sheet listing each line: the exact
fitting rolled, each shard and its running total toward that hull (`3/100`), and
every amount granted. Claim-all itemises the lot.

### 43 · Resource rewards are FIXED PRIZES (627)

Resource cells paid a percentage of whatever the pilot happened to be holding. That
failed on every count that matters, and two builds of label-patching did not save it:

- the cell **could not state what it would give** until you claimed it;
- the reward **rose for hoarding and vanished for spending**;
- the ladder **could not be printed, screenshotted or compared** between players;
- and a 40× cap added to stop the hoarding made it worse — scaled off pilot level, it
  sat orders of magnitude below endgame holdings, so on any developed account the
  payout was **always the cap and never the percentage**. A cell labelled "10% gold"
  paid 0.000001% of it: the amount was right and the label was a lie.

Every cell now pays a **fixed, published amount**:

```
PRIZE_BASE   gold 50M · fuel/iron/plasma 20K
level curve  × level      (level 1 = ×1, level 100 = ×100)
tracks       ×1 / ×5 / ×10      (the shape the old 1% / 5% / 10% had)
```

| Level | Enlisted | Commissioned | Admiralty |
|---|---|---|---|
| 1 gold | 50M | 250M | 500M |
| 25 gold | 1.25B | 6.25B | 12.5B |
| 99 fuel | 1.98M | 9.9M | 19.8M |

The amount **rises with the level** so the last stretch is worth pushing for, but two
pilots on the same level get precisely the same prize — which is the entire point.
Verified live: setting gold to 1 does not change what a cell pays. Claiming all three
tracks is 16× the base, preserving the brief's stacking arithmetic. Every number is
in one `PRIZE_BASE` / `PRIZE_TRACK` block.

The floor, the cap, the held-stock read and the `% res` subtitles are all gone; the
cell now reads `60K / fuel`. `progZone()` survives for item crates, which legitimately
need the pilot's real depth — and it reads the recorded highs rather than
`currentDungeon`, which is 0 whenever the screen is opened outside a run.

### 44 · Hull cells show the ship, and shards show theirs (622–626)

The two hull cells are the milestones the ladder is built around, and a cell reading
the word "HULL" gave them no more weight than a fuel payout. They now render the
**actual ship art** in a portrait frame with a pulsing halo, and the whole row is
flagged so both are findable while scrolling 125 rows.

The frame is portrait because the Vanguard's sprite is genuinely **176×512**: an
earlier fixed `height: 44px` left it **19px wide**. Capping both axes with a tall box
resolves it — Vanguard 32×92, Praetorian 60×92.

**Grants return structured line objects rather than strings**, which is what lets the
claim receipt draw art at all. A shard line shows that **hull's own thumbnail** and a
progress bar toward 100; an item line carries its **rarity colour**; resources use the
same glyph and colour every other screen uses (gold `#f2b24b`, fuel `#5bc0ff`, iron
`#d0a060`, plasma `#c07bff`).

### 45 · Seasonal challenges are not daily (626)

Worth stating because it was a fair thing to be unsure about, and the screen now says
it: each challenge is a **single season-long target** that pays 95 XP **once** and then
stays done. They credit themselves the moment the number is passed, from anywhere in
the game — no claim, no board visit. All twelve are 1,140 XP, and their role in the
budget is slack: dailies and weeklies alone leave a pilot short of 125, so the
challenges are what let someone who misses days still finish the ladder.

### 46 · HOW YOU REACH LEVEL 100, in the product (628)

The screen showed a level and a bar but never said where XP comes from, whether
today's board had already paid, or whether the pilot was on pace — so "how do I reach
100" could not be answered without doing the arithmetic by hand.

A **HOW YOU REACH LEVEL 100** card now sits above the ladder:

- **now → projected**, where the projection is the level reached by clearing
  everything that remains in the season. Green when it clears 100, amber when it does
  not, with a one-line verdict either way — e.g. *"On pace. 9.24K XP still needed for
  level 100 — about 58 more daily boards, and there are 51 days left."*
- **all three XP sources** with their values, what each is worth across the season, and
  a live tag saying **available now** or **collected today / this week** — read from the
  same `dq`/`wq` latches the payout uses, not guessed.
- the arithmetic stated plainly: a level costs 100 XP, the season pays 13K, **dailies
  alone reach about level 90** and the weeklies close the last stretch.
- a button straight through to the mission boards.

Answers the question where it is asked, rather than in a patch note.

### 47 · Hull art never loaded on a cold cache (629)

The level-100 Admiralty cell — the single reward the 25,000 ◈ track exists to sell —
rendered as bare text for most players. **Root cause:** `.tp-cell-art` reserved no
dimensions, so the `<img>` measured 0×0 before load, and a zero-area element inside
`.tp-ladder` (a nested scrollport) never satisfies `loading="lazy"`'s intersection
test. It needed height to load and only got height by loading. Which hull appeared was
scroll-position dependent, and `onerror` never fired, so the cell failed silently.

Only 2 of 375 cells carry an image, so lazy loading saved nothing. Both are **eager**
now with a **reserved box**, which removes the dependency rather than tuning it.
Verified on a cold load with no scrolling: both `complete=true`, natural sizes
176×512 and 460×700.

### 48 · TOUR OF DUTY UX REBUILD (630–631)

Measured before touching anything: **634 words and 2,256px of reading, with the ladder
starting 2,076px down a 779px viewport.** The ladder IS the feature and it rendered
FIFTH, behind four explainer cards. Everything was on screen at once and nothing was
prioritised, so a reward track read as homework.

**Rebuilt around the three questions a player actually has, in that order:**

| | |
|---|---|
| **1. What do I get next?** | `NEXT · LEVEL n` card — the immediate reward per owned track, with ship art when it is a hull. This did not exist at all: a ladder answers "what is the shape of this season", never "what do I get for playing tonight". |
| **2. What am I working toward?** | Three **milestones** with art — L40 Vanguard, L50 XP buff, L100 Praetorian. |
| **3. Show me the rest** | The ladder, **windowed to the current level −2 … +6**, with *See all 125 levels* one tap away. |

**Every word of explanation moved into one "?" sheet.** Four cards of prose became a
ten-row definition list plus the twelve challenges as a compact checklist. Nothing was
deleted — it just no longer stands between the player and the rewards.

Measured after: **41 words** (was 634), **1,072px** (was 2,256), ladder at **768px**
— on screen at first paint rather than three scrolls down. Cells rendered per open:
**27** (was 375).

One consolidation worth noting: `cellLine()` is now the single place a reward becomes
display strings, read by the next-up card, the milestones and the ladder cells alike, so
the three surfaces cannot drift apart.

### 49 · "58 more daily boards, 51 days left" (630)

The pace estimate divided the shortfall by the **daily value alone**, ignoring the
weekly board and the challenges — so it printed an impossibility directly beside "you
are on pace". A pilot clearing both boards earns the daily value **plus a seventh of
the weekly** every day, so that is the rate the estimate now uses, and it reports
**days** rather than boards: *"46 days of clearing your boards · 51 days left."*

Two casualties of the rewrite, caught and fixed in 631: `pace()` was defined inside the
render block that was replaced (so `window.TOUR` failed to publish at all), and
`receipt()` ended up declared twice. `pace()` now lives with the season maths, where a
presentation rewrite cannot take it out again.

### 50 · A state-and-cost pill on every level (632)

Row opacity was the only signal for whether a level was reached — it says "not yet"
without ever saying **how far**. Every row now carries a pill under its number, in one
of four states:

| Pill | Meaning |
|---|---|
| `1.2K XP` | Still ahead. The exact XP from your live total to reach that level — it counts down as you play. |
| `CLAIM n` | Reached, and n rewards are waiting on tracks you hold. |
| `UNLOCKED` | Reached and collected, but cells remain behind a track you have not bought. |
| `✓ DONE` | Everything on this level collected. |

The level column widened 28 → 52px to carry it. Verified across the windowed view and
all 125 rows: no pill overflows its box, no column clips.

### 51 · The Tour has its OWN mission boards (634)

The season used to take its XP by piggybacking on the game's daily and weekly boards
(the Commander's Crate). That left it with **no visible objectives of its own** — a
player could not see what to do today, only that a number had gone up on another screen.

**A TOUR MISSIONS card**, titled *season pass only · auto-credited* so it can never be
confused with the game's boards:

| Board | Missions | Each | Resets |
|---|---|---|---|
| **DAILY** | Combat Patrol · Decapitation · Salvage Sweep · Time on Station | +40 XP | daily, with countdown |
| **WEEKLY** | Sustained Operations · Standing Orders · Logistics Run | +100 XP | weekly, with countdown |

**The XP budget is unchanged.** 4×40 is the same 160/day and 3×100 the same 300/week the
season was always built on — verified live: the season still totals exactly **12,500**.
The difference is that the work is now legible and tickable instead of implicit.

**Every metric is a cumulative lifetime counter read as a delta** against a baseline
snapshotted at each reset (`bd`/`bw`, stamped with the period in `dn`/`wn`). That is the
only way a "today" target can work on save data that only counts upward, and it survives
a reload — a per-session tally would not. Rollover is detected by comparing the stored
period index, so boards reset correctly even if the game was closed for days.

Missions are **auto-credited** like the challenges: a board that also needed claiming
would be a second chore for no decision.

`TOUR.dailyDone()` / `weeklyDone()` are now **deliberate no-ops** rather than deleted —
`missions.js` still calls them, and a browser serving a cached copy of either file must
not be able to pay the season twice.

### 52 · Milestone ship art was 15px wide (633)

`css/fit-guard.css` carries `.scr-body img { max-width: 100% }` at specificity (0,1,1),
which beats `.tp-mile-art` at (0,1,0) — so `max-width: 62px` never applied, `width: 100%`
resolved to 282px, and `object-fit: contain` painted the Vanguard at **15×44** inside a
282px box. On the exact element that exists to make those hulls prominent.

Fixed with specificity **and** a fixed width, so the override is irrelevant either way:
`.tp-mile .tp-mile-art` (0,2,0) at `width: 66px`. Now 66×46 for both. The ladder's hull
cells were never affected — `.tp-cell.hull .tp-cell-art` is (0,3,0) and already won,
which is why this went unnoticed.

The reward window also opened at `level−2`, which hid claimable rewards on earlier
levels. It now starts at the **lowest level with something waiting**.

### 53 · ONE canonical LootCoin icon (635)

The coin in the top bar is now the single source. It declares
`<linearGradient id="lf-lcg">` in `game.html`, and every other coin in the game
references that one def.

Two earlier attempts were worse and both are worth recording. Each icon carrying its own
`<defs id="lcg">` put dozens of duplicate ids in the document, and browsers resolve
`url(#lcg)` against the **first** match — so every coin silently shared one definition
anyway. Minting a unique id per call then broke the moment a caller stored the string and
printed it twice. Pointing at a def already in the markup removes the class entirely:
nothing to duplicate, nothing to inject, and it exists **before first paint** rather than
after `DOMContentLoaded`.

**`window.lootCoinSVG(px)` now exists.** It was already being called in three places in
`ui-v94.js` and was defined nowhere, so every one of those calls fell through to a `◈`
text glyph. The season pass was using `◈` throughout as well — LootCoins were the only
currency in the game not showing their own icon. Every LC surface renders the real coin
now: ladder cells, next-up, receipts, track prices, the help sheet.

### 54 · Challenges removed; the boards are the only XP (636)

Seasonal challenges are **gone**. They were a third earning system with its own rules,
they credited retroactively (a veteran account banked eleven free levels the first time it
opened the screen), and they made "how do I level up" a three-part answer.

Rebudgeted so the two Tour boards carry the whole season:

```
4 daily missions  ×  40 XP = 160/day  × 56 =  8,960
3 weekly missions × 150 XP = 450/week ×  8 =  3,600
                                    TOTAL = 12,560 XP
```

Level 125 costs 12,400, so the season funds it with slack. The split is deliberate:
**dailies alone reach level 90**, so the weeklies close the last stretch and both boards
matter. Verified live.

**HOW IT WORKS was rewritten to match** — 14 rows, led by *Where XP comes from: only the
Tour missions. Nothing else in the game gives season XP.*

### 55 · Track purchase cards (637)

The three tracks were inert chips reading `COMMISSIONED ◈ 5K` — a name and a number, with
no statement of what the money buys and nothing that looked like a button.

Each is now a card with a **price pill**, **value pills**, and a **full-width CTA**:

| Track | Buys |
|---|---|
| Enlisted | 17 fittings · 23 shards · 1K ◈ · ×1 resources · +1% XP · **Vanguard** |
| Commissioned | 51 fittings · 68 shards · 2.5K ◈ · ×5 resources · +2.5% XP |
| Admiralty | 85 fittings · 105 shards · 15K ◈ · ×10 resources · +5% XP · **Dread Praetorian** |

Those totals are **computed by walking the ladder**, not written by hand, so the sales
copy cannot drift from what the columns actually pay.

### 56 · Collected levels still said CLAIM (638)

Every row read `CLAIM 1`, including levels already collected. The pill counted claimable
cells correctly, but the DONE branch could never be reached: the "cells behind an unowned
track" check fired first, and on a free-track account that is **every level**.

Rewritten as a straight ladder of states, specific first: still ahead → `N XP`; something
of mine waiting → `CLAIM n`; **everything I own collected → `✓ CLAIMED`**; reached but
nothing here is mine → `LOCKED`. Claimed and locked pills were also toned down so they
recede rather than compete with the rows that need action.

### 57 · Admiralty is 50,000 ◈ (639)

25,000 → **50,000**. It carries the Dread Praetorian, 15,000 ◈ of payout and ×10
resources, and at 25k the LootCoin rebate alone covered 60% of the price — which is the
concern flagged when the track was first built. `PRICE.admiralty` is the only number that
changed; the track cards, the confirm sheet and the help sheet all read from it, and the
one hardcoded label on the track definition was updated with it.

### 58 · FIGHTER DPS REBALANCED — 7.6× down to 1.10× (640)

Fighters were doing **7.6×** a cannon hull's damage. Measured live on a real account:
**302T/sec** from cannons against **2,297T/sec** from the wing.

`dmgFrac: 0.95` is what did it, and it reads modest — "95% of your damage per craft". The
product does not:

```
wing DPS / cannon DPS = bays × dmgFrac × attackRate / PLAYER_BASE.attackSpeed
                      = 4    × 0.95    × 2.6         / 1.3               = 7.6×
```

Four craft, each firing twice as often as the hull, at 95% of its damage, is eight times
its output before crit, Multi-Shot or rarity are counted.

**Replaced by a ratio, and `dmgFrac` is now derived rather than written.**
`FIGHTER.dpsVsCannon = 1.10` states the intent — the reference wing does 110% of a cannon
hull's base DPS — and `fighters.js` solves for the per-strike share:

```
dmgFrac = ratio × baseAttackSpeed / (refBays × attackRate)
        = 1.10  × 1.3              / (4       × 2.6)        = 0.1375
```

Writing `dmgFrac` by hand is exactly how it reached 7.6×. Deriving it means a change to
`attackRate` or to the player's base fire rate cannot silently rebalance the whole class.

**The ratio is account-independent.** Attack speed folds into fighter damage through
`spdMul`, so `attacksPerSec` cancels out of the division — one number balances the class
at every level of progression. Verified live: 1.10 exactly.

Bigger carriers still hit harder, because more bays IS the progression:

| Hull | Bays | vs cannon |
|---|---|---|
| Vanguard | 4 | **1.10×** |
| Dread Praetorian | 6 | 1.65× |
| Titan Aquila | 7 | 1.93× |
| Celestial Corvus | 11 | 3.03× |

Note those three also mount cannons, so their fighter damage is on top of cannon fire
rather than instead of it. The Vanguard is the only hull where the wing is the whole
weapon, which is why the ratio is pinned there.

### 59 · Rarity was applied to fighter damage TWICE (641)

The 640 anchor held only for a **Common** bay. `fighterSpec()` multiplied the derived
share again by rarity:

```js
dmgMul:  (1 + r * 0.22) * k.dmgMul     // fighter-only, no cannon equivalent
rateMul: (1 + r * 0.05) * k.rateMul    // and it compounded
```

Measured before the fix: **1.10× at Common, 3.32× at r6, 8.95× at r16, 10.96× with a Maul
marque** — worse than the 7.6× the anchor was introduced to fix. **The very first bay
upgrade broke the balance.**

**Root cause: a bay's rarity already reaches damage the normal way.** Its stat lines feed
`attackDamage`, which is the figure fighter damage is computed FROM — exactly the route a
cannon's rarity takes. The `(1 + r * 0.22)` term was a second, fighter-only application.
It was deliberate when the class shipped ("rarity drives the wing's DPS twice over"), but
it is incompatible with the ratio anchor, and rarity won.

DPS terms now carry the **marque shape only**. Range and speed keep their rarity scaling:
neither is damage, so a better bay reaching further and flying faster cannot compound into
the anchor.

Verified live, 4-bay Vanguard:

| Bay | vs cannon | | Marque at r16 | vs cannon |
|---|---|---|---|---|
| r0 Common | **1.10×** | | Talon | 1.10× |
| r6 | **1.10×** | | Maul | 1.35× |
| r16 | **1.10×** | | Lance | 0.99× |
| | | | Swarm | 1.02× |

Marque spread is 0.99–1.35×, which is the intended shape: the Maul trades cadence for
weight, the Swarm the reverse. Range and speed still scale with rarity (r16 = 1.96× reach,
1.64× speed), so a Legendary bay is still plainly better — it just is not better at DPS
twice over.

### 60 · Bay rarity is a RELATIVE WEIGHT (642)

Removing the rarity term in 641 held the anchor and broke the class the other way: a
Common bay and a Legendary bay flew **identically** (measured: same per-strike damage to
the last digit). The Vanguard's own description still promised *"Fit a better fighter in a
bay and that craft hits harder"*, and the whole Fighter Bay drop table existed to make
bays worth farming.

The two mechanisms were fighting because both tried to own the same number. Now they
don't: **rarity sets a bay's weight, and the wing is normalised by its own mean.**

```
dmg_i = baseDmgFrac × w_i / mean(w)        w = rarity × marque
```

The mean of the scaled weights is 1 by construction, so the wing always sums to
`bays × baseDmgFrac` — the anchor — whatever is fitted. Verified live:

| Wing | ratio | per-bay share |
|---|---|---|
| 4× Common | **1.10×** | 1.00 / 1.00 / 1.00 / 1.00 |
| 4× Legendary | **1.10×** | 1.00 / 1.00 / 1.00 / 1.00 |
| 3× Common + 1× Legendary | **1.10×** | 0.53 / 0.53 / 0.53 / **2.40** |
| r2 / r6 / r10 / r14 | **1.10×** | 0.52 / 0.84 / 1.16 / **1.48** |

So an all-Legendary wing deals the same total as an all-Common one — rarity's reward is
reach, speed and the bay's own stat lines, not a bigger multiple of cannon DPS — while
**within** a wing a better bay plainly out-damages a worse one, which is what the drop
table and the ship description both promise.

### 61 · A Fighter Carrier could end up permanently unarmed (643)

Found while verifying the above: the flown Vanguard had **all four bays empty**. The bay
seed added in 603 was a one-time migration latched behind `state.fbaySeed`, and that was
the wrong shape — a bay can become empty long after the migration ran. Selling the
fitting, an auto-sell pass, or a hull swap that stashes gear into `state.fittings` without
restoring all of it leaves a carrier with an empty bay, and a carrier with no bay has **no
weapon at all**: no cannon hardpoint to fall back on and no craft to launch.

It now runs on **every load** and tops up whatever is empty. `seedFighterBays()` only ever
fills empty bays, so it can never overwrite a fitting, and it seeds Common — the floor,
not a gift. Verified: four empty bays refilled on load, wing `armed: 4`, ratio still 1.10×.

**⚠ It must NOT run on the boot thread (644).** 643 put it inline in `migrateSave()`, on
the synchronous boot path — item generation plus `refreshStats()` plus `save()`, for every
owned carrier, in the same first-frame window the watchdog already reports boots dying in
("died during: first-frame"). **Reloads stopped completing at all**: `readyState` stuck on
`loading`, `window.GAME` undefined, and a blocked main thread timing out even a bare
`fetch`. Now deferred 3s behind the first frame. Nothing about topping up a bay needs to
happen before the game is on screen, and because the sweep is a no-op on a fitted carrier,
running it late cannot disturb anything.

Verified across two consecutive reloads: `readyState: complete`, build 644 live, and the
four bay item **ids are unchanged** (`1, 2, 525, 3`) — so a fitted bay persists and the
sweep is genuinely topping up rather than replacing.

### 62 · The wing is normalised on the DPS PRODUCT (645)

642 normalised **damage only**, dividing each craft's `dmgMul` by the wing's mean
`dmgMul`. In a uniform wing those are the same number, so **the marque's damage identity
cancelled out entirely** and its untouched `rateMul` became the only thing setting wing DPS.

That inverted the whole marque design. Measured live on uniform 4-bay wings:

| Marque | design intent | 642 measured |
|---|---|---|
| **Maul Gunship** | "every pass lands like a capital shell" | **0.77×** — weakest, and worse than no fighters |
| Lance / Reaper | neutral | 1.10× |
| Talon | fast, light | 1.375× |
| **Swarm Vector** | "each hit is slight" | **1.65×** — strongest |

A 0.77–1.65× band around an anchor that was asked to be tight, with the two marques at the
extremes doing the opposite of what their own blurbs promise.

**A craft's contribution is `dmg × rate`, so the normalisation has to be on the product:**

```
target = cap × base × attackRate
k      = cap / Σ(w_i × rate_i / attackRate)
dmg_i  = base × w_i × k
```

Σ(dmg_i × rate_i) is then exactly the anchor for **any** mix, while `w_i` still ranks bays
against each other. Verified live — every case **1.10×**, spread 1.10–1.10:

- all five marques, uniform wings: 1.10× each
- r0 / r6 / r16 uniform: 1.10× each
- 3× Common + 1× Legendary: 1.10×, per-bay 0.53 / 0.53 / 0.53 / **2.40**
- Maul + Swarm + Talon + Lance: 1.10×, per-bay **1.73** / 0.61 / 0.79 / 0.89

A marque is now genuinely a **shape**: the Maul hits hard and slowly (1.73× the wing's
average per strike), the Swarm often and lightly (0.61×), and both wings total the same.

**Note for future verification:** compute the ratio from each craft's own `sp.rate`, not
from `CONFIG.FIGHTER.attackRate`. Using the config rate is what hid this — it exercises only
the damage half of the product.

### 63 · The resource row stacked onto two lines

The top-bar fit guard had four stages: three that compressed the chips and a
final one that wrapped to a second row. It now measures the overflow and scales
the whole row by that ratio instead, and wrapping is disabled outright so no
stage can start a second row. One row at every viewport width.

---

## Smoke-test after the push

1. Login screen reads **BUILD 670**.
2. **Map parity** — open the game on a phone and on a desktop window side by side.
   The zone banner, spawn spacing and the distance you must fly to reach loot must
   read the same; loot must NOT arrive at a standing ship on either.
3. **Win a citadel tile in My Galaxy.** The tile must show the citadel at the rank
   the loser held, not a plain tile and not Rank 1.
4. **Moon Colony opens** on an established colony (build something, reload, open).
5. **Cargo Defense, Omega V, 5× on a phone.** The hostile stream must thin rather
   than the frame rate dropping; the ten-minute clock must still land on time.
6. Tab from Battle → Ships → Battle repeatedly: the arena must refill the canvas
   every time, never a small corner on white.
2. Enter a Citadel Siege zone (any zone ending in 7). Fly straight into the
   Citadel and hold there — it must not slide backwards, and must stay on screen.
3. Jump in and out of a boss dungeon 5–6 times. The ship moves every time, on
   auto and on manual.
4. Start a Voidmaw run: auto turns off (by design) **and the joystick appears.**
   Same for an alliance raid and a cargo escort.
5. End a Voidmaw run — auto comes back on and the stick hides.
6. Nanocores → MY HULLS: every Dread-class hull you own is listed.
7. Open the Dread hull detail from the ships screen — no crash.
8. Top bar at 360px wide with large balances: one row, nothing clipped, nothing
   stacked. Rotate to landscape and back.
9. Home Citadel → defend a wave: **the XP bar does not move on any kill.** Gold,
   ore, fuel, plasma and the wave payout all still land, and the wave-cleared
   sheet reads exactly as before.
10. Void Zone → deploy to any spire: **the XP bar does not move and nothing
    drops to the floor** on any kill. Gold still lands, resource scavenge still
    fires, capture / citadel / hourly income all unchanged.
11. Kill the Void Warden and raze a Void citadel: no fittings, but the resource
    bounty still pays and the tile still flips to you.
12. Same two checks on a casino House Citadel hold.
13. Park on a Void tile, close the tab for 10 minutes, come back: the offline
    report shows kills and gold but **0 XP and 0 items found**.
14. Fly a normal zone straight after all of it — XP and loot are normal there,
    including boss loot and citadel showers.
15. On a **Level 1** account: Command → Nanocores opens with the roster, not the
    lock panel. Crates → the Nanocore tab is selectable. No card in Command
    shows a level requirement for Nanocores.
16. **Nanocore merge.** Open cores on device A and let it sync. Log in on device B
    (or a second browser), then back on A. Every core, every unlocked slot and
    every rolled buff is still there on both, and each hull still shows its core
    equipped. Repeat straight after an ascension — that is the reported path.
17. **Voidmaw score survives a relog.** Do a run, note DAILY and SEASON on the
    standings sheet, then log out and back in. Both figures are unchanged.
    Open the sheet on an account whose score is known-rolled-back: the numbers
    repair themselves within one fetch (~5s with the sheet open). Confirm on an
    account ranked **outside the top 100** too — that is the case 593 missed.
    `await CLOUD.sdMine(1)` in the console must return that account's row.
18. **Fighter Carrier.** The Vanguard appears in **Hangar ▸ Ships ▸ Carrier**.
    With one: it moves at a crawl; the Hangar refuses
    every cannon; a Heavy Fighter Squadron equips. In a zone, four craft launch
    only when enemies come inside the envelope, split across separate targets,
    orbit while attacking, bounce to a new target on a kill, and fly home and
    stow when the zone is clear. Damage numbers, crits and loot look normal.
    Then switch to any other hull — the squadron is refused, cannons fit again,
    and that hull's old fitting comes back intact.
19. **Cargo Defense at ★3.** On a ★3 pilot the event opens; on ★2 the lock panel
    reads "opens at Pilot Ascension ★3". Command card subtitle reads ★3+.
20. **Citadel taken whole.** Attack a rival tile holding a Rank 5 citadel and win.
    You own a **Rank 5** citadel on that tile — check Rank, hourly output and the
    defence figure. The prompt says TAKE THE CITADEL, not RAZE. The loser's mail
    says it was taken intact.
21. **Vanguard performance.** Fly it into a dense zone at 5× speed with the wing
    engaged. Frame rate holds; no stutter as fighters fire. Compare against any
    cannon hull in the same zone — they should feel the same.
22. **Fleet tech through the wing.** With a FrostyFrost in the fleet, fighter
    hits chill targets. With Multi-Shot on the fitting, single attacks strike
    nearby hostiles. Life steal heals off fighter damage.
23. **Sprites are not stretched.** Every hull looks like its art in the Hangar,
    in flight and as an escort — check a tall one (Vanguard) and a hull at
    upgrade Lv3+ with a skin fitted.
24. **Cargo Defense gate.** The Command card is not dimmed at ★3 and its subtitle
    reads ★3+ (the menu kept its own `STAR_LOCKS` table, fixed in 601).
25. **Fighter marques.** Collect several bays: each names a marque and shows its
    signature line. Fit a Maul in one bay and a Swarm in another — the Maul craft
    flies slower and hits far harder, the Swarm buzzes and chips. A Lance
    visibly widens the engagement envelope.
26. **Range reaches the wing.** Spend Weapon Range in the skill or pilot tree and
    the fighters engage from further out.
27. **Fighter Bays.** The Vanguard's fitting screen shows **four slots labelled
    "Fighter Bay"** and no Cannon slot. Fighters drop from ordinary kills at
    ordinary rarities. Fit one bay only — one craft launches. Fill all four —
    four launch. Put a Legendary in one bay and a Common in another; the
    Legendary craft visibly out-damages the Common one. A fighter cannot be
    equipped on any other hull.
28. **Delivered flyable.** A freshly built Vanguard has **four Common fighters
    already in its bays** and can fight immediately. An account that already
    owned one before this build gets the same fill on first load. Neither ever
    overwrites a bay you had fitted.
29. **Envelope stays short.** On an endgame range build the wing still engages
    well inside the map, not across it.
30. **XP formula.** `GAME.xpFleetInfo()` on a Pro account with no bonuses returns
    `pct: 500`. Add a bonus worth +10% → `510`, not `550`. `basePct` is 500 on
    Pro, 100 otherwise. The hero XP chip and the My Ship pill agree — and the
    tooltip on each says "one sum, nothing multiplies", never "multiply the base".
    Force bonuses past +500 and both read **· MAX** and name the BONUS ceiling.
31. **Ascension ceiling.** Ascend tab shows **THIS WEEK'S STAR CEILING** with
    ★10 and a countdown to **★11** (+1 per week). The third stop reads
    **Monday, Aug 17 UTC** — check on a US timezone too, where it used to say
    Sunday. `PASCEND.starCap()` returns 10 before Mon 17 Aug
    2026 UTC and 17 after it. An account at ★10 cannot ascend and the tab says
    why. Set the device clock forward a week: the cap reads ★17 with no update.
32. **Equipped core sticks.** On a hull that owns two cores, equip the LOWER
    rarity one on purpose. Log out and back in twice. It is still the equipped
    core both times.

**Discord feed** (after the SQL + function deploy; the feed ticks every 2 min):

33. Buy any hull — even a cheap one. A **NEW HULL** card posts with that hull's
    real sprite as the thumbnail and its proper name in the title.
34. Open Nanocore crates to a Legendary. The card carries the sprite of the hull
    it was recovered for, and a line naming that hull.
35. Take any galaxy tile. The card ends with a 🗺️ line: ring, coordinates,
    sextant, level band. Take one past ring 18 — it adds the deep-space warning.
36. Run a Cargo III or higher and deliver it. A **HEAVY MANIFEST** card posts
    every time with that tier's freighter as the large image.
37. Run a Cargo I — it should stay silent unless it is your first ever or a
    milestone count.
38. Take a Void spire — the card gains the citadel art for that tier.

**If a card posts with no art, work backwards down these three:**

1. `select name, ships, hull_last, cargo_tier from leaderboard order by updated_at
   desc limit 10;` — if `hull_last` is null or empty for someone who just bought
   a hull, the WRITE is being dropped: `discord-art-publish.sql` has not run, or
   the client is on build 590 or below.
   **Then confirm the function is unique**, because a stray overload silently
   swallows the params:
   `select p.oid::regprocedure, p.pronargs from pg_proc p join pg_namespace n on
   n.oid = p.pronamespace where n.nspname='public' and p.proname='lb_upsert';`
   — exactly one row, 21 args, ending `text, text, integer`.
   **A client that tried the art rung before the SQL ran set its `_lbNoArt`
   degrade flag and will not retry for six hours. Reload after running the SQL.**
2. `select content from net._http_response order by created desc limit 3;` — must
   show `"ver":592` or higher. Anything lower and an old function is still deployed.
3. The art file itself: open `https://<site>/ships/ship-<key>.png` directly.
   Discord fetches the URL itself, so a 404 renders as a card with no image and
   nothing server-side can detect it.

The post always lands either way; only the picture is missing.

## Still open (carried forward)

- **Stripe webhook still not deployed** — live payment links take money with
  nothing recording or fulfilling it. Most serious open item.
- Check last-deployed dates on: `stripe-webhook`, `digest-build`,
  `notify-unsub`, `iap-validate`, `delete-account`.
- **Solo-boss DPS display overstates damage** — `theoryDps` counts multishot,
  which needs a second target.
- **No recovery path for already-nulled gold balances** from the pre-578 bug.
- **The Dreadnaught and Voidmaw lost the 12× XP bonus** with all other bosses
  (579). Decide whether they deserve a carve-out.
- **The map will not stay empty** — `galaxyTick()` seeds simulated rival holdings
  again as people play. Expected, but worth knowing.
- **Simulated pilots were not reset** — `sim_pilots` still carries pre-reset
  levels and stars on the boards. Cosmetic; the SQL to pull them in line is in
  chat history.

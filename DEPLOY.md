# Loot Fleet — deploy v246 · build 717 · MECH FOUNDRY + COMMANDERS

Push the **contents of this folder** to the repo root Vercel serves.

Supersedes v245 (build 715). Service worker cache is `lootfleet-v717`.
**Login screen reads `BUILD 717`.**

## ⚠ SQL — FOUR FILES, IN THIS ORDER

`mech-ladder.sql` **must run last** — it supersedes `pilot-ladder.sql`.

**1. `supabase/koth-archive.sql`** — outstanding since 712. Idempotent; if it was
already run at 711, run it again (section 8 is newer). Run the whole file in one go.

**2. `supabase/temple-retire.sql` — run once.** The Temple left the client in 711
but its RPCs are still installed, and the server's `temple_claim()` is the
pre-fix version that throws `42883 operator does not exist: record ->> unknown`
on every call. Stale cached clients still poll it. Drops the temple FUNCTIONS by
catalogue lookup and deliberately leaves the TABLES alone — nothing reads them,
and they hold the record of what players actually did in that arena.

**3. `supabase/mech-feed.sql` — new.** Creates `log_mech()`, the RPC the Mech
Foundry and Commanders post their announcements through. Whitelists five kinds
(`mechWorld`, `mechDeep`, `mechCore`, `mechSov`, `mechCmdr`) and de-duplicates
each so a replay cannot post the same card twice. No new table.

**4. `supabase/mech-ladder.sql` — new, RUN LAST.** Adds `mech_cores bigint` to
`leaderboard` and republishes `lb_upsert` carrying it. **This is now the
canonical `lb_upsert`** — a strict superset of `pilot-ladder.sql` (24 params to
its 23, same order, same types). It drops every existing overload by catalogue
lookup and asserts exactly one survives, because `create or replace` cannot
replace an overload whose argument types differ — it silently adds a second copy
and PostgREST then picks the wrong candidate or refuses to pick (PGRST203).

**Re-running `new-ladders.sql`, `pilot-ladder.sql`, `cargo-ladder.sql`,
`nanocore-ladder.sql` or `discord-art-publish.sql` re-adds an older overload and
requires re-running `mech-ladder.sql` afterwards.**

Verify:

```sql
select column_name from information_schema.columns
 where table_name = 'leaderboard' and column_name in ('pilot_score','mech_cores');
select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.proname = 'lb_upsert';   -- must be exactly 1
```

Then `notify pgrst, 'reload schema';`.

## ⚠ EDGE FUNCTION DEPLOY REQUIRED

`supabase functions deploy discord-feed` — all four files together, a partial
upload does not boot. `FEED_VER` is **717**; verify with
`select content from net._http_response order by created desc limit 3;`

## Order

1. Run the SQL (mech-ladder last).
2. Deploy the edge function (independent of the site).
3. Push everything **except** `version.json`.
4. Push `version.json` **last** — it is the eviction beacon. A higher build than
   the running client force-reloads every session within ~90s, so pushing it ahead
   of the files evicts players onto code that is not live yet.
5. Confirm the login screen reads `BUILD 717`.

## Stamps

| stamp | value |
|---|---|
| root `game.html` `window.LF_BUILD` | 717 |
| root `version.json` | 717 |
| `deploy-v246/version.json` | 717 |
| `deploy-v246/sw.js` `CACHE` | `lootfleet-v717` |
| `discord-feed` `FEED_VER` | 717 |

Every `js/`+`css/` reference carries `?v=717`. Folder rebuilt from the project
root, never seeded from v245: v245 was copied first, then `js/`, `css/`,
`guides/` and `supabase/` were DELETED and re-copied fresh. All 91 js/css files
game.html references were diffed against the root copies — zero stale, zero
missing. Root `sw.js` is deliberately unversioned (it is the kill-switch worker
for the old poisoned origin) and was not touched.

New asset directories in this release: `commanders/` (31 portraits), `ui/`
(Commanders emblem), plus 11 Mech sprites in `ships/`.

---

## What changed in 717

### ⚙ THE MECH FOUNDRY — a new event, Command ▸ Mech Foundry

Five corrupted worlds, Verath through Malgrave, each a wave gauntlet onto a
planet surface rather than a space battle. Gated by LEVEL and by **Pilot
Ascension stars** (★0/5/10/15/20). Each world is assaultable **one hour in six**
on staggered windows — a pure function of the UTC clock, so there is no new save
key, nothing to migrate and nothing that has to be named in `ASC_KEEP`.

Pays ⚙ Mech Cores, loot and gold — **never levels**. Its zones are priced off the
tier, not the pilot, so it is in the XP carve-out beside Cargo Defense, the KOTH
arena and the Dreadnaught Hunt. It is deliberately NOT in `lootBlocked()`: the
hunt and the Foundry withhold levels and keep their loot. Two rules, two lists.

### ⚙ ARMOR CORRUPTION — the Mech faction's signature mechanic

Mech attacks strip the target's armor and the stacks build while they keep
hitting. Applied in both directions from the two existing convergence points
(`resolveHit` outbound, `takeHit` inbound), so bolts, fighters, drones, escorts
and Prism splash all corrupt with one implementation.

Six new Mech hulls feed **one shared pool** ceilinged at **−60%**, which is what
keeps an all-Mech fleet a choice rather than a mandate. Stacks are rate-limited on
the wall clock, so the ramp is a design number and not a function of fire rate or
frame rate.

### ✦ COMMANDERS — a collection, at ★5

31 officers, one seatable per active hull. Generalists, class specialists (×2.2)
and hull specialists (×3.6); an unmet seat pays nothing. Rolls on **its own fixed
rarity table** — no loot luck, no rarity buffs — with resource crates capped at
Mythic and the two LootCoin vaults the only uncapped route. Duplicates fuse
(4 spares → +1 tier) or scrap to dust; dust promotes a card you already hold.

`state.cmdr` is in `ASC_KEEP`, and `own`/`pulls` are unioned in `mergeSaves()`
while `dust` deliberately is not — a spendable wallet max-unioned against a copy
that has not spent yet is the `pasc.pts` duplication bug.

### ⚙ Mech Foundry board in Ranks

Ranked on cores **EARNED**, never the wallet: a wallet falls when you assemble a
hull, and a ladder whose rows drop when you play it punishes playing.
`lb_upsert` writes it with `greatest()`.

### Fixed

- **Autopilot froze in wave zones.** `rt.nodes` is empty in every wave-based zone,
  so the drift step fell off the end of the function without calling any movement
  function at all. There is always a movement call now.
- **The Choir result popup stacked** and never dismissed itself. One veil at a
  time, and it auto-closes with a visible countdown.
- **Better Choir hulls were EASIER to recover** — the roll climbed with depth
  while the tier did too. The chance is now a property of the tier and falls as
  the tier rises (Vhorn 4.4% → 0.5%).
- **Cargo Defense paid fittings from a loophole**, and the Voidmaw ship card
  printed `/100` parts where the event requires 150.
- Ship art draws ~1.5× larger in the arena, and hull class now counts on the
  hangar deck (it was sized off visual tier alone, so every capital shared one
  silhouette).

### Removed

- **"Season 1" is gone from the Voidmaw event** — it is a permanent fixture now,
  with no end date and no countdown on any screen. `SEASON.num` stays `1`
  forever: it is a WIRE KEY every published row carries, not a label.

---

## What changed in 714

### ⬡ Pilot Tree ranks showed AI names instead of real pilots

Real rows read `pilot_score = 0` until each pilot logs in on 713 and publishes,
while **simulated** pilots got a *derived* score — so the invented names sorted
above every real human and the board looked like a room of bots.

The tree is bought with ◇ Dread Cores from a **weekly** raid and rides through
ascension: a deep score is months of real calendar time. There is no honest way
to fabricate that. The board is now `realOnly` — real published trees only. It
will be short while pilots trickle back in, and it says so plainly rather than
padding itself. Same rule the Voidmaw boards learned in 710: **fake rivals are
not a fallback, and if a board can be empty, say it is empty.**

### 🚚 Cargo Defense rebalanced — and why it spiked

**No cargo balance changed in 713. The render loop fix un-masked it.**

`cargo-run.js` has a frame governor that trims the run's population from measured
frame time, floored at 0.35. At 132ms frames it pinned at that floor within ten
seconds of every run, so the mode had been quietly playing at roughly a third
density: ~15 hostiles instead of 43, 9 rings instead of 26, 4 anomalies instead
of 12. Fixing the loop took frames to 5ms, GOV climbed to 1.0, and the untouched
event became unwinnable overnight.

Two things were wrong underneath that, and both are fixed:

**1. A performance governor must never be a difficulty governor.** GOV was
deciding how many hostiles, rings and anomalies exist — so the fight was a
function of hardware. A phone that tripped the governor played a third of the
content; a desktop played all of it. That is precisely the rule `perf-tier.js`
states out loud for the graphics tiers: every performance knob is **paint only**.
The sim ceilings are fixed design numbers now, identical on every device.
`govCap` is gone; GOV stays only as an observation in the flight recorder.

**2. The file exceeded its own stated design target.** Its header says Omega V is
calibrated to "roughly HALF A BEACON permanently: ~25 live hostiles" — and the
level term multiplied that to **43**. Worse, `diff` compounded on four axes at
once (population, spawn cadence, extra hunters, and every hostile's HP), so a
deep pilot faced the product rather than the sum. That is the "impossible for our
best players" report.

| | was | now |
|---|---|---|
| live hostiles (Omega V, Lv 300+) | 43 | **29** |
| collapsing rings | 26 | **12** |
| void anomalies | 12 | **6** |
| extra cargo-hunters per wave | ×2.4 | **×1.2** |
| spawn interval floor | 1.4s | **2.0s** |

**Second pass — the pilot's power now protects the freighter.** Cutting the
population was not enough on its own, and the reason is structural: boarder
damage is capped by COUNT (`LATCH_MAX`), not by how fast the lane is cleared, so
past a certain density the hull lost a fixed rate per second **however hard the
pilot hit**. Best gear, best ships, same result — an unwinnable damage race
dressed as a skill test.

Integrity now **repairs at 1.6/s once the hull has been clear of boarders for
2.5 seconds**. Clearing them is no longer merely pausing the bleed; it buys the
hull back. A pilot who can hold the lane recovers, one who cannot still loses,
and the repair is slower than a single boarder chewing — the freighter is never
immortal.

| | was | now |
|---|---|---|
| boarder DPS on Omega V | 7.9/s | **3.2/s** |
| Omega V hull | 65 HP | **87 HP** |
| Cargo IV hull | 81 HP | **95 HP** |
| Cargo III hull | 100 HP | **109 HP** |
| time to lose a full hull, unopposed | 13s | **32s** |
| repair when clear | none | **1.6/s** |

`frag` is the one fragility number — `hullHp = 100/frag` is exactly what the
Cargo Defense sheet prints, so these move the shop copy and the simulation
together with no second edit.

Rings got cut hardest on purpose: they burn the freighter as readily as the
pilot, they cannot be shot — only outrun — and 26 live rings saturate a 760px
lane completely, so the damage stops being avoidable and becomes a tax on time.
12 is what the mode has actually been survived at, promoted from an accident of
frame time to a deliberate ceiling.

### 📣 Discord posted one card per hull

The `hull_earned` loop posted a full headline embed for **every row**, so one
pilot filling out a hangar produced twelve cards, twelve sprites and twelve
quips inside a single tick, all naming the same person. That is not a volume
problem to be capped — a pilot expanding their fleet is **one** piece of news.

Collapsed by pilot: the newest hull gets the card and its art, the rest are named
on one line beneath it. Four pilots max per tick; the rest still reach the
situation report, which is also one line per pilot now rather than one per hull.

The **"FIRST of this hull in the fleet"** badge now needs ten or more pilots. It
was firing on eleven of twelve messages — true, and completely meaningless.

---

## What changed in 713

### ⚡ The game was running at 7.5fps — and it was never a rendering cost

`loop()` read `if (!rt.running) return;` **before** re-arming rAF. The instant
anything set `rt.running` false for a single frame — `freeze()` on a session
kick, a recovery pass — the animation chain terminated and **nothing restarted
it**. `rt.running` going back to true did not help: there was no longer a
callback scheduled to observe it.

What kept the game alive was the 30Hz watchdog at the bottom of `boot()`, which
only steps when `now - rt.last > 120`. That is a last-resort safety net, not a
game loop, and it produces exactly one step per ~132ms. Measured `_fdt` was
**132.7ms on a 120Hz display with an idle main thread**.

`loop()` now re-arms **first, unconditionally**. A paused loop is a scheduled
callback that does nothing, costs nothing, and resumes on the very next frame.
`rt.last` is kept current while paused so resuming never hands `step()` a
multi-second `dt`. **132.7ms → 5.27ms.** Sim still keeps exact real time.

### ✦ Fighters lost their rarity colour

Same root cause: the LOD governor saw a 132ms frame time and pinned itself at 2
(survival), and the tint was gated behind `lod < 2`. The gate is gone for good —
the tinted blit measures 1.03µs against 0.90µs for the raw sprite, so it was
never a frame-time decision. **LOD sheds decoration; it must never shed
information.**

### ⛨ A failed attack no longer shields the tile

Two shields fired on failure: a 24h one armed on warp-in and committed on your
first kill, plus 15 minutes from `failTimedSiege()`. Losing therefore protected
the tile you had just failed to take — you could not retry and nobody else could
attack. The shield is now stamped **only where a tile changes hands**
(`captureTile`, siege win). Void spires and galaxy tiles share this path.
`log_repelled()` never wrote `cooldown_until`, so this was entirely client-side —
no migration. Existing `tileCd` entries are left to expire on their own.

### ⬡ Pilot Tree rank read zero

`mineInto()` reads every figure on your own row live from the save so it never
lags the publish heartbeat — but the two new pilot fields were missing, so the
row fell through to the server's 0. Now read from `DREAD`, the same source as
the publish.

### ✦ Legendary filter in the Pilot Tree list

Two faults. A legendary node keeps its own combat category and carries
`rare: true` separately, so the Rare chip's `cat === 'rare'` test matched almost
nothing. And the search haystack did not contain "legendary" even though the row
prints that badge. The chip now tests the flag, and anything printed on a row is
searchable.

---

## What changed in 712

### 📰 A "what's new" card on first login

New players and returning ones are different audiences, and only one of them
needs a patch note. `js/patch-notes.js` shows a single card the first time a
player loads a build they have not seen, keyed on `LF_BUILD` in **localStorage,
not the save** — a device fact, so it never rides a cloud save onto another
device and never re-shows there.

**A brand new account is silently marked as seen and shown nothing.** "Battle
speed is now three tiers" is meaningless to someone for whom it is simply how the
game works.

The card is dismissed by the button or the backdrop, and either way it is marked
read — re-showing something a player deliberately closed is nagging. The update
gate outranks it: if a newer build is being force-loaded, that message wins.

**What goes on it is an editorial decision, not a dump of the diff.** The test
for each line is *would a player notice if we never told them?* So the card
carries the retired speed tiers, the cargo loot change, the frozen leaderboards
and the KOTH crown — and carries nothing about SQL migrations, the loot-blocking
refactor, the publish ReferenceError's root cause, the clip auditor, the flight
recorder, or the reserved rarity tier (which is not live — announcing it would
promise something absent). 14 lines, three groups, fifteen seconds to read.

QA: `PATCHNOTES.show()` forces it, `PATCHNOTES._reset()` re-arms it without
touching anything else in storage.

---

### ◧ Graphics quality — Low / Medium / High

For players whose device cannot hold a frame rate on the full render. In
**⚙ Account ▸ Graphics**.

| tier | what it does |
|---|---|
| **High** | Everything on. Full trails, bloom, colour grade, ambient drift. |
| **Medium** | Drops the screen-wide colour grade, the cinematic pass and half the debris. Keeps bloom and ship auras. |
| **Low** | Single-stroke tracers, no bloom, no ambient drift, minimal debris, lower-resolution canvas. |

**It is a floor on the governor that already existed, not a second system.** The
engine has run an automatic LOD governor for a long time — but it only reacts
*after* the frames have already gone bad, which is no use to someone whose phone
is never going to be fast: they spend the first ten seconds of every session in
the mud before it notices. A tier pins the starting point, and the governor keeps
working above it. It can still shed further under load; it can never climb back
above what the player chose.

The biggest single lever is the **canvas backing store**. A 3× DPR handset fills
nine times the pixels of a 1× one for an identical scene, so the tier caps DPR
(2 / 1.25 / 1) before anything else is considered. After that: particle and
debris ceilings, the full-canvas cinematic composite, and the ambient dust layer
— which is a second full-size canvas over the arena, and the cheapest whole layer
to give up.

**Every knob is paint only, and the settings screen says so in green.** Nothing
here touches the simulation — the sim keeps real wall-clock time by design, so
event clocks, offline progress, boss timers and kill rates read identically on
every setting. That guarantee is on the screen deliberately: a player who
suspects Low might cost them progress will sit and suffer at High instead.

First run guesses a tier from device memory, core count and DPR, so a weak phone
starts on Low rather than discovering the setting after a bad session. That is a
starting point only — the moment a player picks by hand, their choice persists,
in **localStorage rather than the save**, so a phone's setting never rides a
cloud save onto their desktop.

---

### 🩹 The leaderboard row has not been publishing since ~688

`CLOUD.lbState()` reported a perfectly healthy ladder — every rung `off: false` —
while nobody's row moved. Both were true, and that combination is the tell: a
rung that is genuinely refused marks itself off, so a clean ladder next to a
frozen row means **no rung ran at all**.

`lbPublish` declared `const art` BELOW the hcwave/expo rung that tests `art` in
its condition. `const` is in the temporal dead zone until its declaration runs,
so the test threw `ReferenceError: Cannot access 'art' before initialization` on
every single publish — and the whole function is wrapped in
`catch (e) { lbFail('throw', e) }`, which turned a coding error into a silent,
permanent publish failure.

This is the second instance of the same shape in this one file. The first was
`_lbShape = shape` in the three Voidmaw reads, which made every SUCCESSFUL read
throw and return null. A bare catch around a whole function body hides a typo
exactly as well as it hides a dropped connection.

The declaration moved above every rung that reads it, and the catch now says
plainly that a throw here is a bug rather than a connection problem.

**Expect leaderboard rows to start moving again the moment this ships**, on every
board, for every player.

### 👑 An awarded prize waited on the player reloading

FrostSkull won the 22 Aug race and got no LootCoins. The server was fine —
`koth_awards` held day 20687, 261,547 kills, `lc 10000`, created 00:01:00,
`delivered = false`. The client simply never drained it.

Both prize drains — KOTH crowns and daily rank awards — were **one attempt about
nine seconds after page load**, returning silently if the player was not signed
in yet, if the cloud client had not come up, or if the RPC failed once. There was
no second attempt for the rest of the session.

And the timing was against them: `koth_close()` writes at 00:01 UTC,
`daily_ranks_award()` at 00:05. A pilot racing for the crown leaves the tab
**open** across midnight, so the single attempt had already run hours before the
award existed. Winning the way you are supposed to win was the way to miss it.

Now both retry until they land — 15s while merely waiting on sign-in, 20s
doubling to a 5-minute ceiling on a real error — and re-arm on the two events
that create new awards: the KOTH day rolling over (asked 95s later, after close
has run) and the tab returning to the foreground on a new UTC day. A genuinely
missing RPC still stops asking; everything else is retried and logged.

**FrostSkull's crown is still sitting in the ledger and will be delivered on his
next load, with or without this build.**

---

### ⚡ Battle speed is three tiers now

4× and 5× are **gone**. The ladder was six rungs deep with three of them free,
which made the paid one a small step and the whole row a wall of pills.

| tier | how you get it |
|---|---|
| **1×** | the game |
| **2×** | bought once — 500 LootCoins |
| **3×** | LootFleet Pro, while it is active |

(10× is still the Mothership easter egg and is still never shown until it fires.)

**2× and 3× used to be free.** They are not any more, which is the one thing in
this release that takes something away, so the migration is deliberately
generous in the other direction: a save sitting on **5× lands on 3×** if Pro is
active, and one sitting on **4× lands on 2×** if it owns the LootCoin unlock.
Neither is dropped to 1×. A release must not read as having stolen someone's
speed.

The LootCoin tier **keeps the sku `speed4lc`**. It reads wrong on purpose: that
string is written into every save that bought the old 4×, and renaming it would
revoke a paid unlock from everyone who owns one. A sku is a receipt, not a label.

Every surface that quoted a speed now reads `PRO_PERKS` instead of restating it
— the HUD pill, the Pro sheet, the contextual offer card, the Pro stat pill in
the ship panel, the purchase receipt label and the Cargo Defense manual. The
ship panel's Pro tooltip had all seven Pro figures typed out by hand.

### ➤ Fighters hit 20% harder, and finally get the wing perk

`CONFIG.FIGHTER.dpsVsCannon` 1.10 → **1.32**. That is the only balance number
for the class — `dmgFrac` is derived from it and the Ship Score ratio reduces to
it — so the buff carries to every carrier, every marque and the published score
without a second edit. A 4-bay wing at 110% of a cannon was parity on paper and
behind it in the arena, because the wing has travel time and can be out of
position.

On the "make sure everything applies" question: almost all of it already did.
Fighters resolve through the same `resolveHit()` a bolt does, with **no `drone`
flag**, so crit, life steal, boss and elite multipliers, Pilot Tree `dmgVs()`,
Siege Protocols, cryo, Starforge freeze, the Voidmaw singularity and the **Prism
Aura's 10% AOE splash** all fire from fighter hits. Their damage reads
`rt.stats.attackDamage`, which already folds in the Pilot Tree, the skill tree,
gear, hull mods and the Warden support aura, and attack speed folds into damage
rather than rate so the wing carries fire-rate bonuses too.

**One thing genuinely was missing:** the **Wing Tactics** ascension perk. Its own
description reads "Escort hulls and drones in your wing deal more damage" —
escort fire applied it, but fighters never did **and neither did drones**. All
three apply it now, so the perk finally does what it says.

---

### ⬡ PILOT TREE — a new Ranks board

Ranked by **Pilot Score**: the sum of every unlocked node on the hex tree, the
same figure the Pilot screen prints. Ties break on nodes unlocked.

It earns its own board because it is the one progression nothing shortens. Nodes
are bought with ◇ Dread Cores from a **weekly** raid — one attempt per tier per
week — and the whole tree rides through ascension. Fleet power can be rebuilt in
a weekend; a deep tree is months of calendar time and nothing else.

Two figures are published, `pilot_score` and `pilot_nodes`, both only ever
climbing (`greatest()`), matching what the save does. Simulated pilots derive a
node count bounded by how many WEEKS the account has plausibly existed rather
than by how strong it is, and nobody below the tree's own unlock level ranks.

`supabase/pilot-ladder.sql` is now the canonical `lb_upsert`. **Re-running
`new-ladders.sql`, `cargo-ladder.sql`, `nanocore-ladder.sql` or
`discord-art-publish.sql` re-adds an older overload and requires re-running it.**

One thing to know about the shape ladder: `CLOUD.lbShape()` now reports `pilot`
as the newest shape, and the shapes are a LADDER — `pilot` implies `new`. Home
Defense and Exploration were testing `s === 'new'` exactly, so they now accept
either; without that they would have switched themselves off the moment this
migration landed.

### ★ The Pro pill showed members nothing

Tapping the LOOTFLEET PRO pill opened the **Pro sheet** for non-members and the
**Account sheet** for members — which carries a status line and a cancel button
and says nothing about what the subscription does. The one surface a paying
subscriber taps was the only one that never listed what they were paying for.

The pill now always opens the Pro sheet. For a member it leads with an ACTIVE
MEMBER banner and the renewal date, retitles the list "Your unlocked benefits",
and offers Manage / cancel in place of the buy button.

Every figure on that sheet is now read from `PRO_PERKS` rather than hardcoded.
The sell copy had "5× XP · 2× gold · +50% loot · 25% beacon · +10 tiles · +1
hunt" written out by hand — six numbers that go stale the day the table is
retuned, on the one screen in the game where being wrong costs money.

---

### 💧 The cargo loot leak — reported as "I found a loot loophole"

A cargo run deploys **deeper than the pilot's own frontier**: `deployZone` is
`depthBase × (1 + 0.10 × tier) + tier × 6`, so Omega V lands roughly 50% past
wherever you have actually reached. Fittings generate at `state.currentDungeon`,
which inside a run **is that inflated zone**. Buying runs therefore bought gear
priced off ground the pilot never took — and that gear pushes the frontier, which
deploys deeper, which drops better gear.

The block that was supposed to prevent this existed, but only in one of four
places. It had been hand-copied and had drifted:

| drop path | guarded by |
|---|---|
| ordinary kill drop | cargo ✓ void ✓ KOTH ✓ |
| Fracture Zone extra drop (Aeternum) | void ✓ KOTH ✓ — **cargo ✗** |
| `bossLoot()` — 5–12 fittings | **void only** |
| `citadelDown()` — 8 fittings | **void only** |

A cargo run spawns a sector boss five times, each flagged `isBoss`. So every run
was quietly paying up to five full boss showers, rolled two rarity tiers up, on
the inflated zone. That is the Lv 1000 gear.

Now there is **one** predicate — `lootBlocked()` — naming the three instances
that deploy above the pilot (cargo run, Void tile, KOTH arena), and all four drop
paths ask it. Gold, salvage, Dread Cores and event currency are untouched
everywhere; this is fittings only. It is deliberately **not** the XP carve-out
list: the Dreadnaught Hunt and Home Citadel defence withhold levels and keep
their loot, as before. Two rules, two lists.

The manifest's dead `item` branch went with it, so the event cannot pay a fitting
from either end.

### 🚚 Bought cargo runs capped at 3 a day

The Pro purchase was uncapped, which made the advertised "2 runs a day" really
"as many as you hold LootCoins for". Three is the ceiling; the button is replaced
by a spent-out line once you hit it, and the count resets with the day.

### ☄ Ascending no longer refreshes the Dreadnaught Hunt

`pilotAscend()` wipes every state key that is not in `ASC_KEEP`. `dreadLock`
(the one-hunt-per-tier-per-week record), `dreadProFree` and `dreadRespawn` were
not on the list, so ascending unlocked the entire tier ladder again: max the
level, run the hunts, ascend, run them again. `cargo` was already protected for
exactly this reason — the hunt was simply missed. All three now carry across.

A lockout is a **clock**, not something the pilot's run earned.

### 👑 Hall of Kings showed "Dec 31" against every crown

Not a date-formatting bug. `koth.sql` shipped `koth_hall_top()` as one row per
crowned **day** — `(day, name, kills, ship, closed_at)` — and the Hall screen was
built to render that. `new-ladders.sql` (build 688) then **dropped it and created
a different function under the same name**: one row per **player**, lifetime
crowns, `(rank, user_id, name, wins, kills, last_day)`. The migration ran. The
client was never told.

So every row read `r.day` off an object that has no `day`. `undefined | 0` is
`0`, and `new Date(0)` west of UTC is 31 Dec 1969 — which is why it printed a
plausible-looking date instead of an obviously missing one. `r.ship` was gone
too, and the kills column was showing each pilot's **lifetime** total on a screen
captioned as a record of single days.

Both boards are worth having, so `koth-archive.sql` §8 adds **`koth_hall_days()`**
— the per-day crown log, under its own name. `koth_hall_top()` keeps the lifetime
standings the Ranks board reads. A new name, never an overload: `create or
replace` cannot replace a function whose argument types differ, it just adds a
second copy.

Three further fixes on that screen: dates now format in **UTC** (the day index is
a UTC day number, so local formatting shifted every crown back a day for anyone
west of Greenwich), a missing day renders as `—` rather than a 1970 date, and
**loading, empty and failed are three different messages** instead of all three
reading "No races have closed yet".

### ⏸ King of the Hill: why it pauses

The presence rule was real and correct — kills only count while the tab is in
front and you have touched the controls recently — but it lived in exactly two
places: a one-time banner when it first tripped, and the pill's `title` tooltip,
which never reaches a touch device and barely reaches a desktop one. The first a
pilot knew of it was the word PAUSED with no reason attached.

- The arena screen now carries a **WHEN KILLS COUNT** card, stating the rule
  before entry, next to NO XP and NO LOOT.
- The pill **prints the reason** on a second line instead of hiding it in a
  tooltip.
- Tapping the pill shows the paused state in full, with how to resume.
- The idle window is **4 → 10 minutes**. Hostiles here deal no damage, so
  watching your fleet work is a legitimate way to play the arena — and on a
  desktop browser that produces no input events at all. Ten minutes still ends
  the overnight tab dead; that absence is measured in hours.

### ⬡ The Pilot Tree has a list view

The tree is an infinite procedural hex grid with fog: you see your unlocked nodes
plus one ring, and everything else is a `?` on a dark field. That is a fine way
to read the SHAPE of a build and a poor way to **spend cores** — to find a node
you drag an unbounded plane around a small viewport with no search, no sort by
cost, and no list of what you already own. It is worse with a mouse than a thumb.

The same nodes are now available as a list: **⬡ Map / ☰ List** in the tree bar.

- **Available** and **Owned** tabs — available is the only actionable set, so it
  leads, sorted **affordable first**, then by cost, then by strength.
- Free-text search across node names, categories and their stat lines; the
  existing category chips filter it.
- Each row carries its effects, ring depth, Pilot Score and an **unlock button on
  the row** — no selecting, scrolling and hunting for a separate action.
- A header line states what you can afford right now.
- The view choice is remembered. The map is unchanged and still there.

Undiscovered nodes are deliberately absent: the fog is a real rule of the tree,
and a list of `?` rows would be the canvas again with worse spatial information.

The clip auditor learned about it too — `.pl-lrows` is a scroll root inside a
fill pane, so nothing in it was being inspected.

---

## What changed in 711

### ⛩ The Temple is removed

Deleted outright, at your request: `js/temple.js`, `js/temple-ui.js`,
`css/temple.css` and `supabase/temple.sql`. Stripped from `game.html` (stylesheet,
both script tags, `#screen-temple`, the Command card, the `.cmd-temple` palette
rules, the `temple:60` level gate, the Command-highlight selector), from
`game-v93.js` (`startTemple`/`endTemple`/`inTemple`, the engine tick and render
hooks, the PvP hit-attribution pass over every projectile, and the `temrun` guards
in `pushEnemy`/`spawnAtNode`/`armAuto`/`setAuto`/`setGameSpeed`), from
`ui-v94.js` (screen route, `templeLock()`, the Ranks tab gate), from
`ranks-boards.js` (the board and `fetchTemple`), `rank-rewards.js`, and
`redeem.js` (six beta codes and the grant).

Two deliberate leftovers. `templeBeta` stays in `account.js`'s merge union list —
removing a name from that list changes save-merge behaviour, and the flag is now
inert. And the Ranks board resets an **unrecognised** tab to POWER rather than
special-casing one id, so an account whose saved tab was TEMPLE lands somewhere
real.

### 👑 King of the Hill crowned the wrong pilot on day 1

`koth_scores` holds **one row per player** with the event day as a column on it.
`koth_bump()` zeroes that row the moment it sees a bump belonging to a newer day.
`koth_close()` runs at 00:01 and reads the finished day out of that same table —
so for the first minute of every race the only copy of the day being judged is a
row that any bump will wipe.

And the pilots who bump in that minute are exactly the pilots still in the arena
at midnight. `js/koth.js` rolls over the instant the clock passes it:

```js
if (ks().day !== dayIdx()) { flush(true); … }
```

That flush lands stamped with the new day, the row resets to `kills = 0`, and a
minute later the close cannot see the leader at all. It crowns the best pilot who
had **stopped playing** before midnight. Being present at the reset was a
disqualification — and the biggest lead is the most likely to still be flying when
the day turns, so the bug selected against the leader specifically.

`supabase/koth-archive.sql` fixes it: a `koth_final` archive table, `koth_bump`
archives the outgoing row **before** zeroing it, and `koth_close` freezes whatever
is still on the closing day into the same archive and judges the snapshot. A pilot
can now fight through midnight without erasing the race they just ran.

Day 1 itself is not recoverable — the leader's total was overwritten with 0 and the
server kept no second copy. Section 6 of that file has read-only queries that say
which bug hit (this one, or the old rate-cap flag rule if day 1 predates
`koth-ratefix.sql`), and `koth_crown_override(day, user, kills)` re-decides a day
and pays the real winner without clawing back what was already delivered.

### ✦ Voidmaw's leaderboard was dead for everyone, always

`sdMine`, `sdDaily` and `sdSeason` in `cloud.js` each carried
`if (!error) _lbShape = shape;` copied from `lbTop` — where `shape` is `lbTop`'s
own local, declared inside it and nowhere else. So the line threw a ReferenceError
on every **successful** read, the surrounding catch turned that into
`return null`, and all three reads failed 100% of the time while looking exactly
like an empty board:

- the sheet sat on "Connecting to live standings…" forever (`_cl.ok` never set)
- both boards read "No operators published yet" with rows in the table
- `sdMine` never landed, so the server row could not act as the floor for a lost
  local run — the reported "my run vanishes when I reload"

`sdread_scores` has one column shape; there is no migration ladder for these to
report. The line is simply gone.

**The phantom "#2 when I'm the only one on the board"** was two things.
`cloudOthers()` keeps every row when `myUid()` is null (AUTH not ready), so the
player's own published row counted as a rival ahead of them — one row, theirs,
counted twice. Ranks now require a known identity. And `syncRanks()` only ever
**wrote** a rank, never cleared one, so a placing observed back when the board
padded itself with generated rivals sat in the save and kept printing. A board
that loaded is now authoritative in both directions: if it does not place you, you
are not placed.

### 🎯 Corner camping paid better spawn rates

Every "spawn at a radius around the pilot" path clamped the result into the world:
`Math.min(worldW - pad, …)`. Mid-map that does nothing. In a corner most of the
ring falls outside the world and every one of those angles collapses onto the
corner — on top of the pilot. So camping a corner had hostiles delivered at
point-blank instead of the intended 640–1160px out, travel time went to zero, and
kills/second rose for **position alone**. On a kill ladder that is the entire
score.

`ringSpawn()` samples angles until one lands in bounds instead, which keeps
distance the constant it was always meant to be. If the pilot is wedged so tightly
that no angle on the ring fits, it falls back to a uniformly random point at least
`rMin` away — further, never nearer. Applied to the KOTH arena top-up, the beacon
swarm (both paths) and the siege wave engine.

### ⚡ Menus lagged while a zone was running

`draw()` is pure painting — every array cap and every `sweepDead()` lives in
`update()`. But it ran unconditionally, so the full arena was composited at device
resolution **behind an opaque menu** on every frame, along with the minimap, the
LOD colour grade and the 8Hz HUD writes. That is the delay: the tap queued behind
a render of pixels nobody could see.

It now returns early when no overlay screen and no Command sheet is covering the
canvas (checked at ~7Hz — `#screen-battle` is not an overlay and never carries
`.active`, so the battle screen *is* "no overlay active"). **The simulation is
untouched** and keeps real wall-clock time exactly as before, which is the rule the
whole `step()` comment block exists to protect. Only invisible pixels are skipped.

### 📱 Mobile: the Command sheet clipped its own cards

The base `.mega-card` rule sets `padding`, `flex-direction` and `align-items` with
`!important` — it exists to force every card into one compact chip shape — so
every unprefixed per-card override in the `max-width:480px` block was silently
losing. The Pilot Ascension pill kept 9px padding and `align-items:center`, and
53px of content centred inside a 50px box with `overflow:hidden` is cut at **both**
ends. That is the title sliced along its top edge.

Fixed by aligning the pill's content to the top and letting height follow content,
with `min-height` as the floor it was always meant to be — the rule
`css/fit-guard.css` states globally. `.pa-pill-lock` was `position:static` while
the mobile rule set `top`/`right`, so it took a flex slot and shoved the chips;
it is absolute now. And cards carrying a badge reserve its width on their **text
column only** — `:not(.mc-ic)` is load-bearing there, since a bare `> div` also
matches the 38px border-box icon tile and would leave its glyph an 8px content box.

Measured at 390×844 and 360×640: zero clipped boxes, all 21 card icons at full
width.

**`js/fit-audit.js` now scans the Command sheet.** It only ever looked at
`.scr-body` and `.sheet-body`; the Command sheet is `#mega .mega-grid`, so the one
screen with fourteen stacked cards on a phone was the one screen the clip auditor
never inspected. That is where the sliced title lived, unflagged.

### 🚫 The Dreadnaught Hunt pays no XP

Same door as the Void tiles. The hunt deploys into a zone priced off its **tier**,
not off the pilot — T20 is Level 505 content — and `killXpFor()` pays on the zone
it is handed. Thirty escalating waves of hostiles carrying zone-505 XP was the
fastest levelling in the game, available to anyone who could survive one deploy.
Dread Cores, the raid-boss drop table, gold and loot are untouched: the hunt's
reward is still the hunt's reward, it just is not levels.

### ⛴ Two carrier apexes are earnable — King of the Hill crowns

Both were `unreleased: true`: finished, flight-ready, and no route to them at all.
They are now ordinary `build:` orders on the existing blueprint system.

| hull | blueprint | build cost |
|---|---|---|
| **Titan Aquila** (Titan, 5 cannon · 7 bays) | 25 KOTH crowns | 25T fuel + 25T iron + 25T plasma + ◈ 1,000,000 |
| **Celestial Corvus** (Celestial, 5 cannon · 11 bays) | 100 KOTH crowns | 100T fuel + 100T iron + 100T plasma + ◈ 10,000,000 |

`state.kothCrowns` is a lifetime, monotonic count and it comes **from the server**,
never from a client counting its own runs: `claim_koth_awards()` marks each row
delivered inside the same statement that returns it, so a crown can be counted
exactly once, and `koth_wins()` reconciles the total as a floor on every login.
Reaching a threshold latches `state.blueprints[key]`, so it reads like every other
recovered schematic — the ✔ BP chip, the merge union, the build sheet.

It is in `mergeSaves()`' union with max-wins. A crown cannot be re-earned: the race
it was won in is over. Per the standing rule, a system absent from that union is
decided wholesale by the base pick.

**Every comparison uses `Math.floor(Number(x) || 0)`.** These costs run to 100e12,
forty-six thousand times past the int32 ceiling, so a single `| 0` anywhere in the
affordability check would wrap the number negative and either lock the button
forever or hand the hull over free. `credits` also joins the build cost ledger and
the cost chips for the first time.

`awardOnly()` now includes `build`. Every build hull carries `price: 0`, so
`buyShip()` would have handed over the Oblivion Spears, the Planetbreaker and both
new carriers for nothing the moment `shipUnlocked()` passed — exactly the failure
that guard exists for.

---

### ⛩ The Temple — pilots could not see or hit each other

Positions travelled as RAW world coordinates. `fitWorld()` gives every device the
same world AREA but lays it out at **the screen's own aspect ratio**, and the
Temple then doubles both dimensions — so `worldW`/`worldH` differ from phone to
desktop. A pilot standing on their own altar broadcast `worldW / 2`, which read on
a differently-shaped screen points somewhere else entirely, frequently outside the
map. The head-count said two pilots were present, the nameplates were drawn off in
the void, and `pilotNear()` tested shots against those same wrong positions — so
the guns did nothing either. One root cause, both halves of the report.

**Fractions are the wire format now.** `cast()` sends `fx`/`fy` (0–1 of the
sender's world) and `temple_pilots()` returns the `fx`/`fy` that `temple_beat` has
been storing all along. A new `place()` step converts fractions to this device's
pixels **every tick**, so a rotation or a resize mid-fight cannot strand a
nameplate. The altar is (0.5, 0.5) in every world, so the shared reference holds.
A payload from an older client is rescaled from its declared world size when it
carries one, and `x`/`y` still ride along for anything still reading them.

### ◎ The altar reads as a place now

The centre was near-black plates at 3–4% white over a near-black arena: from a few
hundred units out there was nothing there, and an empty altar gave no clue that an
item was ever going to appear on it. It is now a **dark well** — a hard-edged
circle darker than any arena background — with a lit rim, two lit plate edges,
slowly turning ribs, and an **empty socket at the centre** with a pulsing dashed
collar. The socket is drawn whether or not anything is on it, because "something
appears HERE" is the one thing the centre has to say. The countdown moved clear of
the socket, and the item now stands in it.

---

### 👑 King of the Hill — the HP ramp is halved and has a real ceiling

Two changes, both by request.

**The ramp climbs at half the old rate.** The multiplier ABOVE base is halved, so
kill 0 is still ×1 (a plain Zone-150 hostile) and everything past it is half what
it was: kill 300 ×4 → ×2.5, kill 600 ×9 → ×5, kill 1,200 ×25 → ×13.

**And it stops at what a Level 300 pilot already fights.** The ceiling is not a
number picked by feel — it is read off the game's own curve every render:

| step | value |
|---|---|
| pilot the ceiling is built for | **Level 300** (`CAP_PILOT_LV`) |
| the zone that pilot flies on-level | **Zone 314** (first zone whose `zoneCombatLevel()` reaches 300) |
| hostile HP there | `enemyHp(314)` = **1.388e12** |
| arena base at `KOTH_ZONE` 150 | `enemyHp(150)` = **3.940e10** |
| so the ceiling is | **×35.2**, reached at **kill 2,200** |
| arena HP at the ceiling | **1.387e12** — the same fight, to three digits |

Retune `enemyHp()`, `dungeonScale()` or the century bands and the ceiling follows
them. Enemy LEVEL is uncapped and keeps climbing past kill 2,200, so depth still
reads on the card.

The twelve printed bands now run ×1 → ×11.39 (LV 200 → 640), the open row reads
"HP climbs to ×35, then holds", and the difficulty card states the ceiling and the
pilot level it is quoted from. The capped readout says **×35.2 MAX** instead of
✖ WALL — the top of the ramp is endgame content now, not an arithmetic wall.

**No server change.** The arena tops its field up by at most 6 hostiles per 0.25s
— **24 kills/s sustained** — against a server allowance of 60/s plus a 300 burst,
so a softer arena cannot push a flush into the rate clamp.

---

## ⚠ Balance changes worth watching

The ×5 resource haul makes Fleet Exploration a net **fuel** source: a five-hull
launch now pays roughly six times its own fuel cost, where it used to about break
even. Ore and plasma were the intended target. If fuel inflation shows up in the
first day, the knob is `RES_MULT` in `js/expedition.js` — or split it so fuel
scales lower than iron and plasma.

**KOTH scores will rise, and the top end becomes an attendance race.** Softer
hostiles plus a ceiling mean a strong fleet pins at the arena's spawn throughput
(~24 kills/s) once past kill 2,200, so beyond that point the ladder measures
minutes present rather than DPS. That is the trade a difficulty cap makes. The
presence rule still applies — kills only count with the tab visible and input
inside 4 minutes — so it cannot be farmed by an open tab. The knobs if it needs
pulling back: `HP_GROWTH` (0.5) and `CAP_PILOT_LV` (300) in `js/koth.js`.

---

## What changed in 710

### ◎ Ship Ascension now counts toward a hull's exploration rating

A hull's survey profile already read yard upgrades and expedition rank. Ascension
— the deepest per-hull investment in the game — did nothing for it, so working a
hull through its module tiers bought no exploration credit. `contribution()` now
carries an `ascMult`: **+1.5% per ascension star**, read through
`ASCEND.shipStars()` rather than restating the model (four modules × 35 = 140
stars, so a fully ascended hull explores at 3.1× its bare profile). Shown on the
hangar row and the pick card as a **✦ N** chip, and folded into the printed total
so the number on the card is the number the maths uses.

### ◈ Every reward chip now says what it pays

The manifest was six glyph-and-number chips in six colours — two of them blue
(⬢ Fuel and ◇ Dread Cores) — so "what are the blue rewards?" was a question the
screen could not answer. Each chip carries its currency name: Gold, Fuel, Iron,
Plasma, Dread Cores, LootCoins.

### ⬢ Expedition resource hauls ×5

The 685 pass cut expedition gold hard and left the ore where it was, so the half
of the payout that is meant to be the reason to run one was the smaller half of
both. Fuel/iron/plasma are now **5×**; gold keeps its depth taper, Dread Cores
(a rarity, not a resource) are untouched.

### ⬡ The launch sheet shows the fleet you are flying now

It listed the hulls you could send and warned once a pick happened to be an
escort, but never said what the battle formation IS — so "which hulls can I
spare" meant leaving the screen. A formation strip now names the flagship
(marked as staying) and every escort, flipping to **PULLED OUT** as you pick it,
with a running "N / M escorts stay".

### ☠ The Voidmaw boards have no bots

Both boards were padded with 99 generated names apiece, and that fake field also
decided the pilot's rank whenever the live board was unavailable. Gone. Every row
is a real published operator; a rank is only ever the one the server reports. An
empty board says it is empty instead of inventing rivals.

Settlements no longer read a fabricated placing either: with no known rank the
daily/season prize pays the participation tier and the letter says why, rather
than crediting a #1 nobody earned.

### 👑 KOTH ranks print hull NAMES

The rows carry the raw save key, so the board showed lowercase internals —
`dread6` for the Dread Omega. Resolved through `CONFIG.SHIP_BY_KEY`, with a
title-cased fallback so a key that outlives its ship entry still can't leak.

### ⬡ The badge count on the cards was one high, per chain

The header counts badges **claimed**; each chain card printed the NEXT rank. With
eighteen chains a player adding up the cards got up to 18 more than the header —
reported as 846 counted against 832 shown, and neither number was wrong on its
own terms. The card counter now states claimed/total, and the grade beside it is
the grade of the highest badge actually claimed. The bar below still tracks the
rank in progress.

### ⬡ The badge ladder's size is stated once

The Ranks board hardcoded 1,000 in four places — the board copy ("out of 1,000"),
the `/1000` unit, the "badges to the Titan Sina" line, and two publish caps that
clamped a real count at 1,000. All of them now read `ACHIEVE.TOTAL` (**1,110**
today), so adding a chain moves every readout at once.

### ⚒ Starforge hardpoints count up

Every secondary slot printed a flat ` II`, so a seven-cannon hull read "Cannon,
Cannon II, Cannon II, Cannon II…" and there was no way to tell which mount you
were tempering. The slot key already IS the ordinal (`bow`/`bow2`…`bow7`), so
they number from it: **Cannon → Cannon VII**. Same for munitions and hulls.

### 🔎 Second pass — more of the same bug classes

- **A false number in reward copy.** The season pass said a hull shard crate takes
  **"100 shards to assemble it"**. Shards roll any buildable hull and each hull's
  requirement is SHIPWORKS' own (25 for early hulls, 2,000 for a Titan Sina), so the
  figure was wrong for every hull in the pool. The card now points at Shipworks
  instead of stating a number nothing supports.
- **The badge total drifted in the mail too.** The podium letter for the Badges
  ladder still read "out of 1,000"; it reads `ACHIEVE.TOTAL` now, like the board.
- **"All seven ladders."** The Discord card and its reward letter both said seven.
  There are thirteen. They now say "every ladder" and cannot drift again.
- **Event Coins were `| 0`'d in ten places.** A balance, coerced to signed int32 —
  the house rule exists because a grant or a migration eventually pushes one of these
  past 2.1 billion and it wraps negative. Now `Math.floor(Number(x) || 0)`.

### ✂ Text pass — less on screen, nothing lost

Two rules: a screen the player cannot use yet does not teach mechanics, and no
message names a thing only a developer can act on.

- **The locked Starforge veil** taught four mechanics in 121 words to players who
  cannot open the screen for another 99 levels. Now one line, the unlock level and
  the progress bar — the same shape as every other lock veil. (The four-panel CSS
  went with it.)
- **"This ladder is waiting on a database migration … until `ranks-ladders.sql`
  runs"** → "This board isn't live yet — no operator has published to it." The
  filename goes to `console.warn`, where the person who can act on it is looking.
- **"Turf war sync failed — server migration required (territory-v2.sql)"** →
  "Territory did not save — your claim is local for now." Same split.
- **Empire at capacity** — 145 words to 75. It explained that a cap is not a
  cooldown, that rivals can claim what you drop, and that VIP loses you nothing.
  Two one-line options and the list of systems say it.
- **The Voidmaw how-it-works sheet, its store footer and its board notes** — every
  rule cut to one sentence, the sales pitch ("even Ranked pays 500 a day") dropped,
  and the retry mechanics behind "score not published yet" replaced with what the
  player actually needs to know.
- **Cargo Defense** — the intro's per-tier depth percentages and the paragraph
  re-explaining battle speed are gone. The one warning that costs the player
  something real (dying strips hull upgrade levels) stays.
- **Abandon confirm, capacity sheet, casino hold note** — design justifications
  ("which would only reward sniping the hold seconds before reset") removed; the
  rules they justify remain.

---

### ⚑ Abandoning a tile no longer mails you a war report

Abandoning releases the server claim, but that release is a network write: until
it lands — or if it never does — the shared map can still name this account as
the owner, so the next convergence pull re-adopted the tile. The moment another
player claimed it, the loss path filed a war report for a system the pilot had
deliberately given up.

`abandonLockLeft()` is the 24-hour record of that decision, so it now answers
both halves: a tile you released is **never re-adopted** (the release is re-sent
instead) and its change of hands files **no mail, no feed line and no toast**.

---

# Previous release — v241 · build 707

---

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v240 (build 706). Service worker cache is `lootfleet-v707`.
**Login screen reads `BUILD 707`.**

---

## THIS RELEASE FORCES EVERY PLAYER TO REFRESH

Three mechanisms, all already stamped in this folder — you do not have to do
anything extra:

| mechanism | how it forces the reload |
|---|---|
| `version.json` = **707** vs clients running `LF_BUILD` 706 | `js/update-gate.js` polls `version.json` every 90s; a higher build blocks the screen and force-reloads within ~90 seconds |
| `sw.js` `CACHE` = **lootfleet-v707** | the service worker cache name changed, so the old bundle is evicted rather than served from disk |
| every `js/`+`css/` ref carries `?v=707` | no browser can serve a stale copy of a changed file |

**Push the site FIRST, then `version.json` last** if your host publishes
incrementally — bumping the beacon ahead of the files evicts players onto code
that is not live yet. A single upload of the whole folder is fine.

---

## ⚠ RE-RUN ONE SQL FILE

`supabase/temple.sql` — **required.** Two live Postgres errors were traced to it,
and the first one means the Temple altar can never spawn. It is
`create or replace` throughout and safe to re-run on a live database.

Then: `notify pgrst, 'reload schema';`

Nothing else server-side changed. No Edge Function redeploy needed
(`FEED_VER` is stamped 707 for the cron log, but the function code is unchanged
since v239).

---

## STEP BY STEP

1. Supabase → SQL Editor → run `supabase/temple.sql`, then
   `notify pgrst, 'reload schema';`
2. Push the contents of this folder to the repo root.
3. Watch: within ~90 seconds every live client blocks and reloads onto 707.
4. Confirm the login screen reads `BUILD 707`.
5. Smoke test:
   - **KOTH** — enter the arena, get a kill. The pill count moves **immediately**,
     not on the next board poll. Leave the tab backgrounded: it reads PAUSED.
   - **KOTH** — rank and kill count on the overlay agree; no "#2 above a bigger #1".
   - **Temple** (beta accounts) — Supabase logs show **no** `21000` or `42883`
     errors, and the altar countdown actually reaches zero and drops an item.
   - **Ranks** — thirteen boards, each with its own empty-state copy.

---

## Build stamps — all agree

| stamp | value |
|---|---|
| root `game.html` `window.LF_BUILD` | 707 |
| root `version.json` | 707 |
| `deploy-v241/version.json` | 707 |
| `deploy-v241/sw.js` `CACHE` | `lootfleet-v707` |
| `discord-feed` `FEED_VER` | 707 |

Audited: all **87** referenced files (69 js, 18 css) byte-identical to the project
root, zero stale, zero missing, every one cache-busted. 90 js files parse clean,
19 stylesheets balanced, no duplicate DOM ids, all 22 Command targets resolve,
zero `| 0` coercions remain on any currency or resource.
`CODES.md` is not in this folder and must never be added.

---

## What changed in 707

### 🗄 Two live Postgres errors, both in `temple.sql`

**`UPDATE requires a WHERE clause` (21000) — the altar could never spawn.**
`temple_tick()` ended its spawn branch with `update temple_presence set
vigil_s = 0;`, unqualified. Supabase runs with the safe-update guard on, so that
raises — and the raise **aborts the whole function**: `next_at` is never
advanced, `item` is never written, and the next poll four seconds later hits the
identical branch and fails identically. Every client in the zone generated an
error every four seconds, indefinitely, and no altar could ever fire. Now scoped
`where vigil_s > 0`.

**`operator does not exist: record ->> unknown` (42883).** `temple_claim()` used
a single `UPDATE … FROM temple_altar old` self-join with `RETURNING old.item` to
capture the item before nulling it. RETURNING across a self-join does not hand
back a typed jsonb column, so `select … into v_item` bound a bare record and the
next `v_item->>'rarity'` raised. Replaced with lock-read-clear
(`SELECT … FOR UPDATE`, then the update) — the lock was always what resolved the
race, so the one-winner guarantee is unchanged; it is three readable statements
instead of one clever one.

Every SQL file in the project was then swept for the same WHERE-less pattern:
clean.

### 👑 The KOTH counter froze between board polls

Build 705 made `myKills()` return the pilot's row from the server board so the
rank and the count could not disagree. That fixed the disagreement and broke
something worse: the board is refetched on a slow interval, so between polls the
number was a frozen snapshot and the pending queue — every kill since the last
flush — was invisible. The pill, the hero card and the overlay all read it, so
the whole feature looked dead.

The board row is the right **floor** (another device may have banked more than
this save knows about) and completely the wrong **ceiling** (pend is real local
work, seconds old). `reconcile()` already keeps `ack` honest against the server,
which is what the disagreement actually needed.

**And a merge could silently disarm scoring.** The no-entry-no-flush guard keys on
`k.entered`, which `enter()` sets — but 702 deliberately stopped OR-ing that flag
across save merges (OR-ing it re-armed the zombie queue that bug was about). A
merge landing mid-session with the cloud copy as base therefore cleared the flag
on a pilot who *was* in the arena, and every later flush binned their kills.
`onKill()` only fires when the run is live, so a kill is itself proof of presence
— better proof than a flag a merge can drop. Setting it there makes the guard
self-healing without weakening it: a device that never enters still never flushes.

### 📝 Copy and terminology

The Temple rules card still read *"The spawn time is unknown — there is no
countdown, for anyone"*, directly beneath an exact countdown. Left over from
before 699, and flatly contradicting the screen it sits on.

Vocabulary is now settled to three words for three things — the **disk** is the
platform you stand on, the **altar** is the event that wakes, **vigil** is time
held alone on the disk. The screen had been calling the platform "altar", "ring"
and "centre" interchangeably, which makes one unusual mechanic read as three.

Power and Haulage had no empty-state copy and fell through to a generic
"Nothing on this board yet." A board that cannot explain its own emptiness reads
as broken rather than new.


---

# Previous release — v240 · build 706

---

## What changed

### 👑 The board could not be reset (705–706)

Three faults, compounding.

**The local total was a one-way ratchet.** Both read sites did
`k.ack = Math.max(k.ack, d.kills)`. The max exists for a real reason — a second
device can legitimately be ahead, and a poll must never claw back kills another
session banked — but it meant a wiped board left the client holding its old
number forever. A server total *below* what we already acknowledged has exactly
one cause: the row was reset. That is now treated as an instruction, not noise —
snap down, drop the pending queue (those kills belonged to the erased run), pull
today's best back with it, restart the sequence, and tell the player the board
was reset so the drop is not a second mystery.

**Rank and count came from different sources.** `rank()` is the server's answer,
`kills()` was the save's, and they were drawn side by side — which is how a pilot
ends up reading "#2 · 2,481 KILLS" above a leader on 458. Whenever the server
board carries this pilot's own row, that row now supplies both numbers.

**The reset script's sequence fence did nothing.** It advanced `last_seq` by 1000
to fence off in-flight work, but `koth_bump` only answers `replay` when
`last_res` is non-null and the script nulls it — so an old client's next flush
was accepted normally. It now sets `last_seq = 0`, which a reconciled client
resumes from cleanly at seq 1 with an empty queue and no bouncing.

### ⛩ The Temple beta card never appeared (705)

`revealCard()` set `style.display = ''` to show it. That *removes* the inline
style, handing the element straight back to `.mega-card.cmd-temple{display:none}`
in the stylesheet — `.mega-card` is `display:flex`, so the fallback is hidden.
The coupon granted correctly and the card could never show. Now a class toggle
(`.beta-on`), so the stylesheet owns both states, evaluated on boot as well as on
the 2-second loop.


---

# Previous release — v239 · build 704

---

## What changed — 695 through 703

### ⛩ THE TEMPLE (695–701) — true PvP zone, Command ▸ Lv 60+

- One shared arena, 4× world, **no hostiles ever** (single `pushEnemy()` choke
  point), no XP/gold/loot except the altar.
- **The disk**: solid platform at centre; the item spawns ON it; the countdown is
  rendered on the deck itself. Spawn interval is random **1–3h**; the deadline is
  public and server-clock-anchored once rolled.
- **The vigil**: seconds ALONE in the ring bend the rarity roll upward (30 min ≈
  3× the top-tier odds). Contested ring banks nothing. A kill inside the ring
  banks 2 minutes and zeroes the victim's vigil.
- **Roll weights**: Relic 46% → Paragon 0.5% (~monthly). Item level 300–500.
  Claim races resolve by row lock — one winner, ever.
- **Kills**: killer-reported (as specified), server-checked — both present,
  adjacent (≤900u), victim alive, 1.5s attacker cooldown, every claim logged
  accepted or refused. Victim announces its own death pre-teardown so the report
  fires; damage applies through the victim's own engine (normal death penalty,
  byte-identical).
- **1× speed forced, autopilot disarmed, both UI controls hidden**, restored on
  exit. Joystick stays (fixed after a regression).
- **Ladder**: Ranks ▸ TEMPLE — altars first, kills second, deaths shown never
  ranked. Server-written tables only; nothing self-reported.
- **Discord**: claims announce; Celestial/Paragon get the full headline banner.
- Honest limit, on the record: a modified client can refuse incoming damage and
  be unkillable. The server bounds forged KILLS; it cannot make a client feel
  hits. Watch `temple_kills` for pilots with absurd K/D and zero deaths.

### 👑 KING OF THE HILL — phantom kills (702)

`pend` (the unflushed kill queue) merged **max-wins** across devices, so every
same-day second-device login resurrected already-flushed kills, and the 30s
background flush resubmitted them under a fresh seq. Score climbed with nobody in
the arena. Now: pend merges **min-wins**, an adopted save's queue is zeroed, and a
device that never entered today cannot flush at all. `koth-reset-day.sql` clears
the inflated board.

### 🪪 FORCED-RENAME BUG (703)

The sign-in privacy scrub (real-name leak protection) trusted only `lf_name`
metadata — written by one fire-and-forget request in `setName()`. If that write
ever failed, a later sign-in misread the player's CHOSEN name as a Google leak and
force-renamed them to a callsign ("why is my name grimthorn?"). The scrub now
honours the save's own `nameSet` latch as proof of choice and re-stamps missing
metadata on sign-in. Affected players keep whatever they pick at the naming
prompt; the original name is not recoverable from code.


---

# Previous release — v238 · build 694

---

## What changed in 694 — THE MODEL, NOT THE NUMBERS

Reported as "the HP ramp is not viable". It was not a tuning problem, so tuning
would not have fixed it.

### Why exponential could not work

679 tripled HP every 100 kills. With a `×r` ramp, doubling your DPS buys a
**fixed** number of extra kills no matter how strong you already are — about 63
kills at ×3. Years of fleet building and one afternoon of it hit the same wall
within a few hundred kills of each other. That is not a difficulty curve, it is a
stop, and everything past it is the same outcome wearing a bigger number: by kill
1,100 a hostile carried 300,000× base HP, which at Zone 150 is 3×10¹⁴.

### A square law instead

```
hp = (1 + kills / 300)²
```

| kills | OLD mult | NEW mult | reduction |
|---|---|---|---|
| 300 | ×20 | ×4 | 5× |
| 600 | ×500 | ×9 | 56× |
| 1,200 | ×900,000 | ×25 | 36,000× |
| 5,000 | ×1.2e18 | ×312 | astronomical |

Cost per kill still rises without limit, so the race keeps its natural ceiling and
still runs forever — but the ceiling **moves with the fleet**. Modelled over 24
hours, 1000× the DPS earns **11.1×** the kills (cube-root scaling, exactly what a
square law predicts). Strength is properly rewarded and cannot run away with the
board, which is what a daily ladder wants.

Early game got easier too: the old table jumped ×1 → ×5 at kill 101; it is now a
smooth ×1 → ×1.78.

### Two supporting fixes

- **The difficulty card was lying.** It still advertised "HP triples / 100", which
  stopped being true the moment the curve changed. A card describing a curve the
  game does not run is worse than no card. It now states the actual rule and
  quotes the formula.
- **The twelve display bands are DERIVED from the curve** rather than hand-written,
  so the table and the maths cannot drift apart the way a literal table and a
  formula always eventually do.

### What to watch

With HP this much lower the binding constraint becomes the **spawner** (about 90
hostiles topped up every 0.25s), so top scores will now be throughput-bound rather
than HP-bound. If daily numbers come back too high, the honest lever is
`HP_SOFT` in `js/koth.js` — lower it and the curve steepens everywhere at once.


---

# Previous release — v237 · build 693

---

## What changed in 693 — THE XP CAP

**Asked: is 1000% real, or are players over it getting a hidden benefit?**

**It is real.** `state.xp` is incremented from exactly one place — `gainXp()` —
and it multiplies by `xpFleetInfo().mult`, which is
`min(1000, base + min(500, bonuses)) / 100`. No module writes XP directly and no
module applies a second multiplier outside the capped stack. All seven sources
(VIP, Pilot Tree, Neural Uplink, Nanocore, Combat Computer, Kaevith Resonance,
Tour of Duty) funnel into that one sum.

| stacked bonuses | FREE paid / raw / wasted | PRO paid / raw / wasted |
|---|---|---|
| 500% | 600% / 600% / 0% | 1000% / 1000% / 0% |
| 900% | 600% / 1000% / 400% | 1000% / 1400% / 400% |
| 5000% | 600% / 5100% / 4500% | 1000% / 5500% / 4500% |

At 5000% of stacked bonuses the multiplier is still exactly 10× for Pro and 6× for
free. The overflow is dead weight.

**But the chip was lying, in the opposite direction.** The cap is only 1000% *for
Pro*. The total is base + bonuses; Pro's base is 500, a free pilot's is 100 — so a
free pilot's real ceiling is **600%** and they can never reach 1000 however much
they stack. The chip quoted the flat 1000% to everyone, promising 400 points of
headroom that cannot exist, then displayed **CAPPED** at 600 — which reads as a
broken number rather than a rule.

It now quotes the pilot's own ceiling (`myCap`), and when the stack overflows it
names the waste outright: *"CAPPED AT 600% — your bonuses add up to 1000%, so 400%
is being discarded and pays you nothing."* A bonus that pays nothing must never
look like a bonus that pays.

---

## What changed in 692 — THE ARENA COULD BE FARMED BY AN OPEN TAB

Reported as "my account keeps gaining kills in King of the Hill". The kills were
real, and they were caused by build 681.

681 made arena hostiles deal **zero** damage — the punching-bag change. Right for
the mode, wrong for its economy: with no damage and no death, a pilot who simply
leaves the game open in the arena keeps auto-firing against a field that respawns
forever. The 24-hour race stopped measuring how hard someone played and started
measuring who left a tab open, which is the one outcome a leaderboard must never
reward.

**Kills now only count while the pilot is present.** Two independent tests,
because they catch different absences:

- **the tab is hidden** — backgrounded, another app, screen locked. Immediate.
- **no input for 4 minutes** — visible but untouched. The overnight case, and the
  one the zero-damage change opened up.

The run is **not** ended — that would be a nasty surprise on a phone that dimmed
for a second. Kills stop counting, the pill turns grey and reads **PAUSED** with
the reason, a banner announces both the pause and the resume, and the moment the
pilot touches the screen they carry on with everything they had. Kills silently
not counting is indistinguishable from a broken feature, so the UI says so
outright rather than freezing a number.

### `koth-reset-pilot.sql` — wiping one operator

Resets `realsina1` on the daily board. Prints every match before acting, so a
typo removes nothing.

It zeroes the row **in place** rather than deleting it. The row carries
`last_seq`, and `koth_bump` refuses any sequence at or below the last it
accepted — delete the row and the counter restarts at 0 while the client is still
climbing, so every submission afterwards returns as a replay and that player
silently stops scoring for the rest of the day. It also advances the sequence by
1000 to clear anything in flight.

Crown removal from `koth_hall` is included but **commented out**: it rewrites
history and changes the CROWNS ladder for everyone. Undelivered prizes are
removed; already-delivered ones are not, because a prize the player has received
as mail and spent cannot be clawed back by deleting a ledger row.


---

# Previous release — v236 · build 691

---

## What changed in 691

**Home Defense and Exploration reported "waiting on a database migration" with the
migration already run.**

The check inspected the returned leaderboard rows for the new `hcwave`/`expo`
columns. It deliberately skips two kinds of row, and both skips are correct on
their own terms:

- **the player's own row** — the game merges the live save over it, so those fields
  are always present whether or not the column exists;
- **every simulated pilot** — `derive()` fills the same fields client-side.

On a board where few humans have published, that leaves **nothing to inspect**, so
the check returned "not migrated" permanently. The failing state was
indistinguishable from the real one, which is the worst property a diagnostic can
have — it sent the operator to re-run SQL that had already run.

The probe was inherited from Haulage and Nanocore, which only pass because enough
humans have published to them. It was never correct; those two boards were
concealing it.

**The fix: ask the server, not the rows.** `cloud.js` now records which `SELECT`
shape actually succeeded (`CLOUD.lbShape()`). If the query requesting
`hcwave,expo,expo_best` came back clean, the columns exist. That is a direct
statement about the schema and cannot be faked by a locally merged row.

**And a third state, because there really are three.** Before the first board read
lands — offline, signed out, first paint — the answer is genuinely unknown, and
both wrong guesses are bad: accuse a healthy database, or rank a board of
simulated pilots as though they were records. The probe now returns `unknown`,
the board renders as loading, and it re-renders when the read arrives.


---

# Previous release — v235 · build 690

---

## What changed in 690 — INTEGER OVERFLOW, FIVE PLACES

A player reported Fleet Exploration always saying NOT ENOUGH FUEL. The cause was
`resources.fuel | 0` in the confirm sheet. **Bitwise OR coerces to a signed
32-bit integer**, so any balance above 2,147,483,647 wraps negative — 2.4 billion
fuel displayed as −1,924,456,846, and the launch button compared against that.

The model was never wrong: `launch()` compares `(res.fuel || 0) < cost` with no
coercion, so the fuel was really there and really spendable. It was a display read
that then gated the button, which is why it hit **only** the players with the most
fuel.

Auditing for the pattern found four more, two of them worse:

| where | what it did |
|---|---|
| `game-v93.js` `addCredits(n)` | `n \| 0` on the GRANT AMOUNT. The 100-billion LootCoin coupon calls `addCredits(1e11)` and paid **1,215,752,192** — one percent of the promise, silently. Coupons, season pass, achievements and alliance rewards all route through it. |
| `game-v93.js` `addDreadCores(n)` | identical wrap on core grants |
| `paragon-cannon.js` | `(s.credits \| 0) < PRICE` — a player past 2.1B LootCoins could not buy it |
| `expedition.js` payout | `R.fuel \| 0` etc. on the REWARD. At depth `econ()` clears 2.1B easily, and the wrap goes negative — **subtracting** resources as the reward for a clean run |
| `expedition.js` recall | same wrap on the refunded launch cost |

All now use `Math.floor(Number(x) || 0)`: same whole-units intent, no ceiling. The
only `| 0` left anywhere near a resource name is an array index, which is correct.

**Player impact worth knowing:** anyone who redeemed the 100B LootCoin coupon
received 1.2B. A make-good has not been issued.

---

## What changed in 689 — THE DISCORD FEED, REBUILT

`index.ts` had grown to ~1,950 lines with about thirty event kinds declared
inline, each carrying its own colour literal, icon and header string. Three
consequences, all visible in the channel:

- **Nothing had a priority.** A pilot signing up and a galaxy-first crown were both
  "one embed" competing for the same ten slots. On a busy tick the crown could be
  the thing that got cut.
- **Ten cards of equal weight read as noise**, several of them "X hit level 220".
- **Colours were duplicated and drifting** — `COLOR` was declared in two files.

### The new structure

| file | role |
|---|---|
| `catalog.ts` | the event registry — every kind's feature, tier, colour, icon, label, GIF mood. One place that answers "what can the feed say". |
| `render.ts` | tier-aware publishing: the split, the ambient rollup, the banner |
| `voice-688.ts` | copy for the three new features, each in its own register |
| `index.ts` | sources and collectors only |

### Three tiers, and the tier decides presentation

- **headline** — own message under a full-width banner, always art or a GIF,
  **never dropped for volume**
- **notable** — an embed when there is room
- **ambient** — never gets a card. Rolled into one digest line per kind:
  "⚑ **4×** claimed — Vex, Orin, Rell +1" carries the same information as four
  cards for one line.

Overflow now names only genuinely CUT events. The old line mixed "just missed the
cut" with "deliberately not worth a card", which made it read as a dumping ground.

### New announcements

- **Fleet Exploration** — sparse milestone counts (first, then 10/25/50/100…),
  because an active pilot lands several a day. Plus a headline when someone fields
  a **★★★★★ wing** (rating 350 — four of the best hulls in the game fall short).
- **Home Defense** — wave milestones as notables; the four era boundaries
  (20/50/100/250) as headlines, since those are where the game itself changes what
  spawns and doubles production.
- **King of the Hill dynasty** — lifetime crowns from `koth_hall`. Winning once
  was already announced; winning repeatedly is the better story and nothing was
  telling it.

### Two judgement calls

**No `release` event for citadel abandons.** The tile vanishing from `territory`
already fires `lost` through the two-miss detector — the same news from a source
that exists. A separate kind would need the client reporting its own abandons,
which is forgeable and redundant.

**`expoElite` says "fielded a ★★★★★ wing", not "came home clean."** The
leaderboard carries the wing rating, not a per-run outcome. The copy states what
the data proves.

Five older events (the KOTH suite, a finished Nanocore) post their own messages
directly and predate the tier system. They already behave like headlines, so they
are marked `selfPost: true` in the registry rather than rewritten — churning a
live feed's loudest paths to satisfy a refactor is how a working thing breaks.
Registry audit: **zero orphans** — every entry has a producer or is flagged.

---

## Known gaps carried into this release

- **`restoreEscorts` skips silently** when the player has refilled the battle
  formation while an expedition was out. Deliberate, but unannounced.
- **22 orphaned files** in `js/`+`css/` that `game.html` never loads still ship
  (`lf-*.b6/b7`, `sim-*`, `tweaks.js`, `showcase.js`, `features-data.js`,
  `css/features.css`).
- **Merge receipts start from build 684.** Currency lost before that has no record.


---

# Previous release — v234 · build 688

---

## What changed in 688

### ⛨ Home Defense ladder

Ranked by the deepest Home Citadel wave you are **holding**. A breach damages the
base and halts mining but never rolls the wave back, so "holding" and "career best"
are the same number and the board states the stronger one honestly. The meta line
names the production era — RARE at 20, EPIC at 50, LEGENDARY (×2 production) at 100,
MYTHIC at 250. Ties break on fleet power.

### ◎ Exploration ladder

Expeditions completed and **debriefed**. A fleet still in flight is not yet worth
anything and a recalled run never counts. Ties break on the strongest wing ever sent
out, so a pilot who runs ★★★★★ wings outranks one who farms ★ runs at the same count.

### 👑 King of the Hill ladder — one tab, two views

**TODAY** is the live race, read straight from `koth_top()` and reset at 00:05 UTC.
**CROWNS** is the career record: days won, counted from `koth_hall`, ties broken on
total kills across winning days.

Neither view goes through `lb_upsert`. A crown is awarded by `koth_close()`
server-side, so it cannot be self-reported and the board needs no anti-cheat probe
of its own — the eligibility test already ran at close. Two boards answering the same
question on different clocks belong under one tab, not as two more entries in a strip
that is already twelve wide.

### ✕ Citadel abandon lockout — 24 hours, and it closes a real exploit

Abandoning a system clears `state.tileCd`, because a tile nobody owns is not
contested. That made abandon-and-reclaim a **free shield reset**: a pilot under siege,
or sitting on a protection about to expire, could release the system and immediately
take it back for the price of one warp — fresh 24-hour shield, citadel rank intact.
The neutral grace period that exists to protect a released tile from bots was being
used as a reset by its own former owner.

The account that walked away is now barred from that tile for 24 hours. **Rivals and
real players can move in straight away** — that is the entire point of abandoning.
Applied on every abandon, not only citadel tiles: the shield reset is worth exploiting
on a bare tile too, and a rule that applies sometimes is a rule players have to guess at.

The confirm sheet states the penalty before you commit, and a blocked warp is refused
with a live countdown rather than a generic "cannot deploy".

**The lockout is unioned in the save merge, latest-expiry-wins.** Left unnamed it would
be decided by the base pick like anything else — and a second device holding a
pre-abandon copy would clear the penalty, making the merge itself the exploit the
lockout exists to close.

### ✉ Mail copy now covers every ladder

`rank-rewards.js` carries podium copy for all twelve boards. The three added here
were written in 680 against ladders that did not exist yet; they are live now.

---

## Rollout notes

- **Both new boards refuse to render until the migration is detected**, showing a
  "waiting on a database migration" note rather than ranking every human at zero.
  That is deliberate: a board that silently credits simulated pilots with records no
  human can be shown to have set is worse than no board.
- **The publish path degrades independently.** The new columns are the topmost rung
  with a 5-minute back-off (not six hours like the settled rungs) — a refusal here
  usually means "the SQL has not run yet" or "PostgREST has not reloaded", both
  measured in minutes. `CLOUD.lbState()` reports every rung's status.
- **Simulated pilots get derived figures** for both new boards, seeded on the pilot's
  name so they never drift between devices or refreshes, and tapered so a bot's
  expedition count stays bounded by plausible real-world time rather than by level.

---

## Known gaps carried into this release

- **`restoreEscorts` skips silently** when the player has refilled the battle
  formation themselves while an expedition was out. Deliberate — their choice
  outranks our bookkeeping — but unannounced.
- **22 orphaned files** in `js/`+`css/` that `game.html` never loads still ship as
  dead weight (`lf-*.b6/b7`, `sim-*`, `tweaks.js`, `showcase.js`,
  `features-data.js`, `css/features.css`).
- **Merge receipts start from build 684.** Currency lost before that has no record;
  reports from here on can be sized from `state.mergeLog` instead of guessed.


---

# Previous release — v233 · build 687

---

## What changed since 674

### ◈ Fleet Exploration (675–676, 681, 685–686)

Dispatch up to **five hulls** on real-time expeditions from Command ▸ Fleet
Exploration. The flagship never leaves; escorts are pulled out of the battle
formation while they are away and **returned to a free slot when they land**.
The outcome is sealed at launch by a seeded PRNG over (mission, launch time,
account), so closing the tab cannot reroll it and neither can the player.

Five difficulty tiers, ★ (req 20) through ★★★★★ (req 350). The top tier needs a
genuine five-hull wing — four of the best hulls in the game fall short.

**Gold was retuned twice and the second pass mattered.** Kill gold is exponential
in zone but the things gold buys are fixed constants (Dread Omega 50B, Titan Sina
~5T), so any purely kills-anchored payout eventually buys a hull per run no matter
how small the multiplier. The per-kill anchor is now raised to a fractional power
(0.85), which bends the faucet toward the price ladder instead of racing it:

| zone | ★ 3h | ★★★ 6h | ★★★★★ 18h |
|---|---|---|---|
| 8 | 3.17K | 17.7K | 87.4K |
| 45 | 105K | 588K | 2.90M |
| 150 | 42.5M | 238M | 1.17B |
| 305 | 256M | 1.44B | 7.08B |
| 600 | 1.47B | 8.24B | 40.6B |

Early game is essentially unchanged; the compounding comes off the deep end
(Zone 305 ★★★★★ went 1.11T → 7.08B across the two passes).

### ♛ King of the Hill (677–681, 687)

A 24-hour galaxy-wide kill race in its own arena, reached from Command. Endless
difficulty ramp — every 100 kills raises the tier, and there is no cap.

- **Punching-bag zone.** Hostiles deal **zero** damage. The arena already revived
  the pilot with invulnerability on death, so damage only ever cost tempo in a mode
  measured entirely in tempo. Enemy fire still renders.
- **Hostiles grow with the wall.** Size scales on `1 + log10(hpMult) × 0.05`,
  hard-capped at **2.4×**, and bigger ones lumber. A full 90-hostile field never
  occludes the pilot.
- **Scaling happens at spawn, not on the next tick.** The build-680 fix: at endgame
  DPS a hostile dies inside the frame it spawned in, so the tick-sweep scaler never
  saw it and the entire difficulty table silently did nothing.

### ✉ Ladder winnings arrive by mail (680)

Every ranked ladder — including King of the Hill — now writes its own letter.
A podium finish (1st–3rd) gets that board's own copy naming what it measures and
what the finish means; 4th–100th arrives as one compact digest for the day. Every
award row's LootCoins are carried by exactly one letter either way. A podium finish
worth no LootCoins sends as an ordinary letter rather than a prize with a dead
Claim button.

---

## Bug fixes

### The KOTH anti-cheat was disqualifying the best players (681)

`koth.sql` conflated "exceeded the rate limit" with "is cheating". The cap was
6 kills/s with a flag after 12 clamps; the arena holds 90 hostiles and the tier
table starts at ×1, so an endgame pilot legitimately does 20–50 kills/s for the
first few hundred kills. **Every flush clamped, every clamp flagged, and about
thirty seconds in they were silently ineligible for the crown — permanently, every
race.** Their queued surplus also drained at 6/s, so their visible score ran
minutes behind their real one all day.

The rate cap is now a database protection set above anything the spawner can
physically produce (60/s sustained, 300 burst). Cheat detection is a separate test:
only a claim **3× past that ceiling** counts as evidence. Ordinary clamping is still
recorded in `koth_audit` for forensics but no longer touches `flags`. The
migration zeroes existing flags, since every one was raised by the broken test.

### The KOTH replay guard could permanently stop a player scoring (687)

`koth_bump` is at-least-once, so a committed transaction whose response is lost
would be retried and applied twice. The 681 fix added a per-player monotonic
sequence — but the client counter was never reset on the day boundary and was not
unioned in the save merge, so a merge, a restored backup or an offline device could
hand a player a counter **below** what the server had already accepted. Every
submission then came back `replay`, and the client cleared the pending delta on the
assumption that meant "already counted". It does not: it means "this seq was seen",
which after a merge is a different delta entirely. **The player keeps killing and
their score never moves again for the rest of the day.**

The client now reconciles against `d.kills` — the server's authoritative total —
minus what it last saw counted. That difference is exactly what landed, whatever the
seq did, so it can neither double-count nor lose a kill. A replay that reconciles to
zero jumps the counter forward instead of bouncing. The counter resets on the day
boundary (matching the server), the merge takes max-wins on it, and any in-flight
marker is dropped on merge.

### Expeditions were quietly dismantling the battle formation (681)

`launch()` pulled an escort out of the fleet and nothing ever put it back — the slot
stayed empty after the fleet landed. Invisible, too: nothing on the Expedition screen
mentions the fleet, so it presented as "my ship score keeps dropping" with no cause.
Escorts now return to a free slot on collect **and** on recall, never over a hull the
player has since slotted themselves.

### Pilot Skills flickered the whole screen on every point spent (682)

Every `+` called `renderSkills()`, which reassigns `innerHTML` for the entire tree —
destroying and recreating every node, replaying every entry transition at once and
resetting scroll. Spending a point now updates only the counter, the bought node and
the affordability state of its neighbours. A tier unlock is genuinely structural and
still does one full render; full renders now preserve scroll position. Skill buttons
moved to delegated click handling.

### Save hardening — additive only (684, 687)

`mergeSaves()` names ~35 fields, and any field it does not name is decided wholesale
by the base pick — the losing copy's version is discarded silently. Added unions for
the fields where a union is **provably** safe because they only ever move one
direction:

| field | guard |
|---|---|
| `purchases` | none — no reset revokes a purchase |
| `invSlotsBought` | max-wins |
| `blueprints` | epoch-guarded |
| one-way latches (`flightWaiver`, `unlimited`, `discordJoin`, `nameSet`, …) | OR |
| `casino` lifetime records | max-wins |

**Deliberately excluded: gold, credits, resources, dreadCores, prismIngots,
inventory, equipped, fittings.** Those are spendable and there is no correct union
for two divergent balances — max-wins refunds whatever the other device spent (buy a
hull on the phone, merge with the tablet's older copy, keep both the hull and the
gold), base-wins loses real earnings.

So for currency the base pick has to be right, and when it is wrong the loss must be
**recoverable**. Every merge that discards a copy holding more of something spendable
now writes a **receipt** — what won, what lost, and how much was on the losing copy —
capped at the last 5 and wrapped so a receipt failure can never fail a merge. It
grants nothing. The next wipe report can be sized from data instead of guessed.
As of 687 the receipt is itself unioned, so it survives the merge it documents.

### Voidmaw compensation codes (683)

Ten single-use codes grant the Voidmaw event carrier to players hit by the wipes.
One per account, not repeatable; a second code redeemed by the same account reports
the hull is already held and grants nothing. Only SHA-256 hashes ship. Plaintext
lives in `CODES.md` at the project root, which is **not** in this folder.

### A live stylesheet was truncated mid-block (687)

`css/web-v89.css` ended inside an unclosed `@media (prefers-reduced-motion)` rule.
Browsers auto-close at EOF so nothing visibly broke, but anything appended to that
file would have silently landed inside the media query.

---

## Known gaps carried into this release

- **Three ladders are specified but not built** — Home Defense (deepest wave),
  Exploration (expeditions completed) and King of the Hill (daily + lifetime wins).
  `rank-rewards.js` already carries the mail copy for all three (`hcwave`, `expo`,
  `koth`); the boards themselves are not in `ranks-boards.js` yet. Harmless — the
  copy falls back — but the ladders do not exist.
- **Citadel abandon timer** — the 24-hour lockout on re-claiming an abandoned
  citadel is not implemented.
- **`restoreEscorts` skips silently** when the player has refilled the formation
  themselves. Deliberate (their choice outranks the bookkeeping) but unannounced.
- **22 orphaned files** in `js/`+`css/` that `game.html` never loads ship in this
  folder as dead weight (`lf-*.b6/b7`, `sim-*`, `tweaks.js`, `showcase.js`,
  `features-data.js`, `css/features.css`).

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

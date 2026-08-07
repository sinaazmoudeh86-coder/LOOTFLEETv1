# LAUNCH — deploy-v215 · build 469

Stamps verified aligned: `version.json` **469** · `LF_BUILD` **469** · SW cache `lootfleet-v469`.
All 71 local asset references resolve inside this package. All 13 changed JS modules parse
cleanly. Every new API added this session is exported and every cross-module call resolves.

---

## Order matters — SQL first, then the site

The client already ships code that calls the new RPCs. If you publish the site before running
the SQL, players see the casino board in an **offline** state and the alliance rename button
errors. Nothing breaks permanently, but do it in this order.

---

### 1. Run the database migration that stops the error flood — DO THIS FIRST

**Supabase → SQL Editor → New query → paste → Run**

    supabase/bignum-power-fix.sql

This is the fix for the ~270 errors/hour you were seeing
(`22P02 invalid input syntax for type bigint: "2.348e+29"`).

Late-game fleet power reaches ~2.3×10²⁹ — about 25 billion times bigint's maximum — so every
cloud save was failing and affected players' rows had silently frozen on every ladder.

It rewrites `lb_upsert` / `fr_upsert_profile` / `fr_position` **from the catalogue** rather than
from hand-written signatures, because the live `lb_upsert` has 13 arguments and installing a
second copy of that function broke your leaderboard once before. Whatever is live gets widened;
no new overload appears.

**What you should see:** `NOTICE: WIDENED public.lb_upsert(...)` lines, then a final table
listing `power`, `kills`, `fleet_power`, `attack_power`, `defense_value` all as `numeric`.

**Stop and tell me if you see either of these:**
- `WARNING: DUPLICATE OVERLOADS: lb_upsert has N copies` — the ambiguity fault is back.
- an error mentioning a dependent object — I removed `CASCADE` deliberately so this fails
  loudly instead of deleting something quietly.

Then confirm the error rate drops in **Logs → Postgres**. That is the success signal.

---

### 2. Run the casino citadel schema

    supabase/casino-citadels.sql

Creates the three holds, the daily loss pool, payouts, the big-bet callout table, and schedules
`casino_daily_payout()` at **00:10 UTC** (after your existing ranks job at 00:05).

Safe to re-run — 21 idempotency guards, no destructive statements. It also backfills the
share (1/2/3%) and level ladders (100/300/500) on an existing install.

Verify:

    select id, name, share_pct, req_lv, owner_name from casino_citadels order by id;
    select * from cron.job where jobname = 'casino-daily-payout';

Three rows and one scheduled job.

---

### 3. Add the alliance rename function

    supabase/social.sql

Now safe to run whole. It previously failed with:

    42P13: cannot change return type of existing function
    HINT: Use DROP FUNCTION friend_list() first.

`friend_list()` and `pilot_search()` return `leaderboard.power`, which step 1 widens to
`numeric`, and Postgres cannot change a function's return type via CREATE OR REPLACE. Both now
DROP first and declare `numeric` — which also matters because declaring `bigint` there would
silently re-narrow the exposed type and revive the error flood you just fixed.

Order-independent: run it before or after step 1, either works.

The ✎ rename button in the alliance header errors until this file is applied.

---

### 4. Redeploy the Discord function

    supabase functions deploy discord-feed

Two additions: a `🎰 THE HOUSE CITADELS` section in the 3-hourly report, and immediate
big-bet callouts. Without this redeploy the game works fine, the channel is just quiet.

---

### 5. Publish the site

Upload the contents of `deploy-v215/` to your host (Vercel).

Because `sw.js` cache is bumped to `lootfleet-v453`, returning players get fresh assets rather
than a cached 452 mix.

---

### 6. Smoke test, in this order

1. **Load the game.** Confirm the build gate lets you in — `version.json` and `LF_BUILD` both
   read 453, which is the check that locked everyone out at v214.
2. **Hangar ▸ Ships.** Seven tiers: Frigate 4 · Cruiser 6 · Battleship 7 · Carrier 15 ·
   Dread 8 · Titan 1 · Aegis 1. Icons should be roughly half their old height.
3. **Space Casino.** The three holds appear under the bet chips showing `1%`, `2%`, `3%` and
   `LV 100/300/500`. Tap one: it must offer **⚔ CLAIM — LAUNCH THE SIEGE** (or a level gate),
   never an instant claim. Tapping it should warp you to the battle screen with the entry toll
   deducted. Winning the wave set is what takes the hold.
4. **Place a bet over a threshold** (500M gold, or 250 LootCoins) and check Discord posts
   within ~2 minutes.
5. **Ascension screen.** Confirm the ledger says your galaxy, Home Citadel, Moon Colony and
   Prism are **carried over**, and that ASCEND is clickable on desktop.
6. **Zone list.** Scroll for a `CHOIR` tag (Zone 12 and 16 are the first two).
7. **Postgres logs.** Error rate should be near zero.

---

## New SQL this build — run with the deploy

    supabase/voidmaw-season-reset.sql

Archives Season 1 standings to `sdread_scores_s1_prescale`, then zeroes the live board.
Required with the rebalance: sdread_upsert is ratcheted (totals only climb), so pre-scale rows
would sit unbeatable forever. Client wipes season progress once (flag `rebal4`) but keeps all
paid rewards — coins, parts, prizes, the assembled Voidmaw.

Also redeploy edge functions: `discord-feed` AND `digest-build` (badge count fix).

## What shipped since 462 (this package: 466)

**RECOVERY BANNER ORDERING FIX (469).** load() stamped the boot marker before init read the
previous one, so the mid-play crash marker self-erased and the banner never fired. The pre-boot
marker is now captured first. The banner also shows the running build number — if a player's
banner says an old build, the deploy didn't reach them.

**PROJECTILE CAP (468).** Drone and escort fire pushed into rt.projectiles with NO ceiling —
player shots fold past 90, but a 30-drone carrier vs a regenerating Qa-HP casino warden at 10×
speed pumps shots faster than impacts remove them (the reported siege crash). Capped at 240 at
the fire sites + a 260 splice in update. Crash breadcrumbs also moved sessionStorage →
localStorage: a frozen tab gets CLOSED, and the relog lands in a NEW tab where sessionStorage
is empty — which is why no recovery banner appeared. Now it survives tab replacement.

**CRASH-LOOP BREAKER (467) — deploy this immediately.** The player-wide crash wave is the
storm-bolt overflow from 466 (not Frosty-only gear: every endgame chain-lightning build feeds
it), and the "site won't load after a crash" is a RELOAD LOOP: a mid-combat freeze marks the
session healthy, so the next boot skips safe mode, auto-resumes the same combat and dies again
seconds later. 468 detects the mid-play death (no clean-exit marker), enters RECOVERY MODE
(visual effects hard-trimmed for the session, banner with the last watchdog sample baked in for
screenshots), and the watchdog now writes localStorage so crash forensics survive the dead tab.

**FrostSkull freeze SOLVED (466).** Storm Conduit gear pushed lightning-bolt visuals into
`rt.bolts` — the one combat array with no hard cap. At endgame proc rates (90%+ crit,
multishot, 5× speed) thousands of polylines were alive at once and the tab was OOM-killed.
Now capped at 66/80; chain damage is unaffected (it lands before the visual). A play watchdog
also samples all combat array sizes + heap every 10s so any future mid-combat freeze names
its cause on the next load.

**Badges board fixed (463).** Ranks read `state.badgeRanks`/`achClaimed` — fields that never
existed. Real players all published 0. Now reads the same `achieve.claimed` sum the Missions
screen shows; digest edge function fixed identically.

**Voidmaw season reset (464).** See SQL above.

**SAFE BOOT (465).** If a login dies (breadcrumb never reached 'alive'), the next boot
automatically skips the offline sim, return brief and v4 gear remap, and shows an on-screen
banner naming the dead phase — no console needed. The v4 migration and offline sim are also
permanently try/catch-wrapped, and the save repair walks 14 levels deep. For the FrostSkull
case: deploy, have him log in twice, get a screenshot of the banner.

## What shipped since 453 (462)

**Galaxy-wide number rebalance (456).** dungeonScale now tapers past zone 100 (+2%/zone to 300,
+1%/zone beyond): zone 400 accounts drop from 1e29 to ~1.5T HP / ~45B damage rolls. Zones ≤100
byte-identical; XP kept on the legacy curve so leveling pace is untouched. One-time scaleVer-4
save migration re-derives item stats (roll preserved, double-run is a no-op) and scales wealth
by kills-worth. Side effect: score maths can no longer reach the float ceiling.

**FrostSkull login crash bolt-down (454/455).** Save repair resets non-finite fields at load
(with a console count); stageInfo() can no longer hang on a poisoned total; computeStats and
gainXp reject non-finite values; boot breadcrumbs name the dying phase on the next login
(`load-save → stats → nodes → offline-sim → ui → return-brief → territory → first-frame → alive`).

**ship-panels safe() bug (460).** isNaN(object) is true, so every object result fell back:
the XP pill never rendered for anyone, and Empire Income said "nothing is paying you" despite
owned tiles. Both now show real figures; XP + Loot Quality pills always visible (grey at +0%).

**Casino tow fix (458)** — securing a House Citadel now returns you to the casino floor, not
the Void Zone. **XP chip on My Ship power line (457).** **Ships tab: Aegis now sits between
Battleship and Carrier (461). Loot Quality pill (462).**

## What shipped in 453

**New — Ember Choir event.** Zone Grind incursion, sister to Kaevith. Five recoverable hulls,
~1 zone in 30 from Zone 10, deterministic per zone. The encounter that ends the zone becomes a
Choir hull (+55% hull, +28% damage) and its boss arrives in ~2–3 min instead of 10–15. Reward
axis is the beacon, not XP: −cooldown, +duration, +swarm, +loot, capped 45%/150%/100%/150%.

**New — Casino house citadels, sieged like Void spires.** Three holds (CC1/CC2/CC3) paying
1% / 2% / 3% of *server-wide* daily losses, all five currencies including LootCoins.

They are REAL TILES, not an ownership flag — marked `void: true` so they inherit the entire
proven siege loop rather than duplicating it: Lv 100/300/500 gate, resource entry toll, a Warden
clone fleet at ×1.15 your score that must actually be beaten, 50/150/250 waves, capture only via
`captureSystem()`, 24h shield on capture, abandon, and territory sync. There is no claim button
and no server claim RPC: a hold changes hands only by winning a siege, and the payout reads the
holder from `territory`. They pay no hourly income — the house cut is the whole reward, so they
aren't strictly better than a Void spire at the same level.

Payout 00:10 UTC as labelled claimable mail. Discord gets holders, shares and shield timers in
the 3-hourly report, plus immediate big-bet callouts (tiered per currency, rate limited to one
per pilot per 90s unless the next round doubles it).

**New — Alliance rename**, ✎ leader-only, ◈1000 each time, tag stays fixed. LootCoins charged
only after the server accepts, so a rejected name never bills.

**Fleet XP capped at +1000%** on the combined multiplier. Found and removed a hidden
`min(100)` clamp inside the Kaevith field that was silently discarding most of a full 5-hull
bonus. `gainXp()` and the XP pill now read one source, so displayed and applied can't drift.

**Loot table.** `rarityCap(zone)` returned 13 for every zone, so Ascendant/Celestial/Paragon
could never drop at any zone or ascension count — `ascReq` was gating tiers the zone cap had
already excluded. Zone caps now extend (115/140/170), `ascReq` lowered to 12/25, and the top six
weights sit on a ~5× ladder. `rollRarity` and `rarityChances` had drifted apart (1.30 vs 1.18
dampener, so shown odds were 3–7× too generous); both now read one `rarityWeights()`.

**Build timers removed.** Pay and the hull lands in your hangar. In-progress builds are handed
over on next load.

**Fixes.** Desktop ascend (a legacy `.pa-ack` rule put an invisible ✓ pseudo-element over the
whole modal, so clicks toggled the checkbox off instead of hitting ASCEND) · auto→manual camera
break (two causes: `joy.active` left true, and `resize()` moving the camera target without a
snap) · ascension ledger falsely claiming galaxy/Home Citadel/Moon/Prism reset · `emb2` had an
invalid `cls:'Destroyer'` that fell back to gatling escort fire with no accent · boot-overlay
copy button claiming success over a dead clipboard call · Command menu one-column breakpoint at
430px while large iPhones report 440pt · `payPrize()` accepting fuel/iron/plasma and silently
dropping them.

---

## Known gap, deliberately not fixed here

`sim_pilots.power` is bigint clamped to 9e17, so it never errors — but that leaves the
simulated ladder eleven orders of magnitude below a real endgame player, so sims will sit far
below your top humans. Widening it means rewriting several `::bigint` casts inside the sim
growth and rival-tuning functions. Worth doing deliberately, not inside a hotfix. Say the word
and I'll do it properly.

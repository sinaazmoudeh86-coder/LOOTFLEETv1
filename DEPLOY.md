# Loot Fleet — deploy v227 · build 591 · COMBAT FIXES · VOID/CASINO CLOSURES · DISCORD GAME ART · NANOCORES UNGATED · NANOCORE WIPE FIXED

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v226. Service worker cache is `lootfleet-v591`.
**Login screen reads `BUILD 591`.**

**Build 591 requires one SQL run** (`supabase/discord-art-publish.sql`, step 1 of
THE SEQUENCE). Without it every Discord card posts with no art — the exact bug
this build exists to fix. No reset, no data migration beyond that one file.
Otherwise a bug-fix release plus one balance change.
Four fixes from the Aug 13 field reports (the stuck ship in boss zones, the Void
Citadel that could be pushed out of the arena, owned Dread hulls reading as
unowned in Nanocores, the resource row stacking onto two lines) and three reward
closures: **Home Citadel defense pays no XP**, and **Void Zone / casino tiles pay
neither XP nor fittings.**

Carries builds 583–591. **Build 591 needs one SQL run** — `discord-art-publish.sql`, see the sequence. If v226 never went live, read that folder's DEPLOY.md
first — this folder contains its season-reset code too, and **its SQL sequence
still applies.**

---

## ⚠ FOUR STAMPS MUST AGREE — verified for this folder.

| Stamp | File | Build 591 |
|---|---|---|
| Client constant | `game.html` → `window.LF_BUILD` | `591` |
| Update beacon | `version.json` → `build` | `591` |
| SW cache name | `sw.js` → `CACHE` | `lootfleet-v591` |
| Project root beacon | root `version.json` (source tree) | `591` |

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
| references carrying `?v=591` | **1** (`cloud.js`) |
| `game.html` byte-identical to project root | **yes** |

Seeded from `deploy-v226`, then `js/`, `css/`, `guides/` and `supabase/` deleted
and re-copied from the project root as separate calls (never a bulk copy over
patched files — the v216 failure), then all 74 referenced files byte-compared.

Files changed: `js/game-v93.js`, `js/entities.js`, `js/ui-v94.js`,
`js/nanocores.js`, `js/account.js`, `js/cloud.js`, `css/web-v89.css`,
`css/readability.css`, `supabase/functions/discord-feed/index.ts`.

**Re-cut eight times** — 584 Home Citadel XP, 585 Void Zone XP, 586 Void/casino
loot, 587 the Discord game-art feed, 588 the Nanocores level gate removed, 589
the nanocore wipe, 590 the equipped-core repair narrowed, 591 the art fields
actually reaching the table. All four stamps are at 591. If you pushed this
folder at 583–590, push it again.

---

## THE SEQUENCE

1. **Supabase → SQL Editor → run `supabase/discord-art-publish.sql`.** Safe to
   re-run. It adds the three nullable columns to `leaderboard` and `sim_pilots`
   AND re-creates `lb_upsert` so the client can actually write them — it is a
   superset of `discord-art-fields.sql`, so run this one and skip that file.
   **Without it every card posts with no art**, because the values are discarded
   at the RPC.
2. **Deploy the `discord-feed` Edge Function** from `supabase/functions/discord-feed`.
3. **Push this folder** to the repo root and let Vercel build.
4. **Then** confirm `version.json` reads 587 at the live URL.

Steps 1–2 are safe to run before the push: an old client publishes nothing into
the new columns, and the feed posts those cards without art rather than failing.
Doing them after the push is also fine — the feed just stays art-less until then.

The SQL DROPS the 18-argument `lb_upsert` and creates a 21-argument one. That is
deliberate: PostgREST resolves `rpc()` by argument NAME, so leaving both in place
makes an older client's call match two candidates and fail outright. Clients on
build 590 and below keep publishing through the same function — their calls just
omit the three new params, which default to null and leave the columns alone.

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

Three parts:

- **`supabase/discord-art-publish.sql`** — new migration. Re-creates `lb_upsert`
  with the three params, dropping the 18-arg form so PostgREST has one candidate.
  An empty string never clears a stored value: a client publishes every 90
  seconds and only one of those publishes follows a hull purchase, so overwriting
  with `''` would blank the key before the feed's next 2-minute tick — exactly
  the race that produces an art-less card.
- **`js/cloud.js`** — a new top rung on the degrade ladder sends the three
  params, with its own `_lbNoArt` flag and 6-hour re-arm, so a server that has
  not run the migration keeps publishing every other ladder untouched.
- **The feed's copy** — `hullName('')` returns the phrase "a new hull", which
  cannot take an article. The title and the line now have a named and an unnamed
  form, so a row with no key still reads correctly.

`FEED_VER` is now **591**, tracking the client build (was 570 — never bumped when the art code
shipped). That number is echoed in every response, so
`select content from net._http_response order by created desc limit 3;` proves
which build of the function is actually live.

### 10 · The resource row stacked onto two lines

The top-bar fit guard had four stages: three that compressed the chips and a
final one that wrapped to a second row. It now measures the overflow and scales
the whole row by that ratio instead, and wrapping is disabled outright so no
stage can start a second row. One row at every viewport width.

---

## Smoke-test after the push

1. Login screen reads **BUILD 591**.
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
17. **Equipped core sticks.** On a hull that owns two cores, equip the LOWER
    rarity one on purpose. Log out and back in twice. It is still the equipped
    core both times.

**Discord feed** (after the SQL + function deploy; the feed ticks every 2 min):

18. Buy any hull — even a cheap one. A **NEW HULL** card posts with that hull's
    real sprite as the thumbnail and its proper name in the title.
19. Open Nanocore crates to a Legendary. The card carries the sprite of the hull
    it was recovered for, and a line naming that hull.
20. Take any galaxy tile. The card ends with a 🗺️ line: ring, coordinates,
    sextant, level band. Take one past ring 18 — it adds the deep-space warning.
21. Run a Cargo III or higher and deliver it. A **HEAVY MANIFEST** card posts
    every time with that tier's freighter as the large image.
22. Run a Cargo I — it should stay silent unless it is your first ever or a
    milestone count.
23. Take a Void spire — the card gains the citadel art for that tier.

**If a card posts with no art, work backwards down these three:**

1. `select name, ships, hull_last, cargo_tier from leaderboard order by updated_at
   desc limit 10;` — if `hull_last` is null or empty for someone who just bought
   a hull, the WRITE is being dropped: `discord-art-publish.sql` has not run, or
   the client is on build 590 or below.
2. `select content from net._http_response order by created desc limit 3;` — must
   show `"ver":591`. Anything lower and the old function is still deployed.
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

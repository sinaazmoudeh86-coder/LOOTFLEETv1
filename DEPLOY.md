# Loot Fleet — deploy v215 · build 437

Push the **contents of this folder** to the repo root Vercel serves.
Supersedes v214. Service worker cache is `lootfleet-v437`.

**Headline:** THE KAEVITH INCURSION — a galaxy-wide event, five earnable alien
hulls, a 3-hourly Discord situation report, and a performance pass.

---

## Step 1 — run the SQL

Supabase → **SQL Editor** → **New query** → paste **`supabase/xen-hull.sql`** → **Run**.

Installs `log_xen_hull()`, the RPC that announces an earned Kaevith hull to
Discord. Without it the hulls still drop and still work — they just never get
announced.

The grant is resolved client-side inside battle resolution (the roll is part of
the fight), so the client has to report it, and a reported achievement is
forgeable from devtools. The RPC is built like `log_repelled()`:

- identity comes from `auth.uid()`, never the payload
- the ship key is validated against a fixed five-key list
- **idempotent per (pilot, hull)** — each of the five can only ever announce once
  per account, so a replayed or scripted call posts nothing

**Verify** — must return one row:

```sql
select oid::regprocedure from pg_proc
 where proname = 'log_xen_hull' and pronamespace = 'public'::regnamespace;
```

Safe to re-run.

## Step 2 — redeploy the Discord Edge Function

Supabase → **Edge Functions** → **discord-feed** → **Code** → paste
**`supabase/functions/discord-feed/index.ts`** → **Deploy**.

This one is overdue: the function has been running the pre-v214 build. The new
code adds the hull announcement and the 3-hourly report.

**Cron success proves nothing** — `net.http_post` returns immediately, so a green
cron row only means the request was sent. Verify by watching the channel for the
`🏆 SINA ⚔ FROSTY — SINA TAKES IT` headline format, then wait for the next
`📡 FLEET SITUATION REPORT`.

No new cron job is needed. Both features ride the existing 2-minute tick; the
report gates itself on a timestamp in `feed_seen`, so its clock survives redeploys.

## Step 3 — push the site

Folder contents to the repo root, commit, let Vercel build.

## Step 4 — hard-reload once

`Cmd/Ctrl + Shift + R`. Cache name changed, so the old bundle is evicted on first
load.

---

## What shipped

### THE KAEVITH INCURSION

Roughly **one zone in five** in My Galaxy is held by an alien fleet. Invaded zones
render as purple voids with a `◈` mark, a legend entry, and a tappable event
banner above the map. A briefing popup opens once per day on entering My Galaxy.

**Which zones are invaded is deterministic** — rolled from a fixed event seed keyed
on tile coordinates, from its own RNG stream so no existing tile property shifts.
Every account sees the same invaded map with no server round-trip. The set never
grows, respawns, or rerolls, and the flag survives capture (a zone you own stays
invaded, which is what keeps the hunting grounds available).

**Ownership logic is untouched.** Claims, citadels, shields, cooldowns, empire cap
— all unchanged. The invasion only changes who garrisons a tile.

**Combat.** Every hostile in an invaded zone flies a Kaevith hull at **+35% hull
and +22% damage** over that ring's normal garrison, and the zone boss becomes a
Kaevith Warden (Overseer if super). Larger hulls appear as rings deepen.

**Earning a hull.** Clearing an invaded zone rolls **1% on ring 1 → 10% at the
rim**, on a sqrt curve so mid-rings aren't dead, weighted toward bigger hulls in
deeper rings. Never sold, never blueprinted. The end-of-battle popup reports the
result either way — win, miss (with the exact percentage that zone rolled), or
"you already hold all five".

There is a hidden floor after a long dry streak. It is deliberately not surfaced
anywhere — no popup, HUD, briefing line or Discord mention — because a visible
guarantee turns the event into a checklist players grind to a known number. There
is a comment at the constant explaining this; please don't helpfully expose it.

**The five hulls**, entry → Dreadnaught:

| Hull | Class | Fleet XP |
|---|---|---|
| Kaevith Splinter | Frigate | +10% |
| Kaevith Shard | Cruiser | +25% |
| Kaevith Glaive | Battleship | +45% |
| Kaevith Sovereign | Carrier | +70% |
| Kaevith Godshard | Dreadnaught | +100% |

The XP bonus is the point: any Kaevith hull in the fleet — flagship **or** escort —
raises XP on **every kill the whole fleet makes**. Bonuses add, capped at +100%,
applied inside `gainXp` so every XP source benefits. The Godshard sits just under
Dread Omega on raw stats; it is not a power-creep hull.

### Discord — 3-hourly situation report

One message every three hours: top 5 Fleet Power, top 5 Territory, Voidmaw Season
standing with the deepest run, all seven Void spires with holder and shield state
(as relative timestamps, so each reader sees their own timezone), Incursion
status with a per-hull recovery count, and what moved in the last three hours.

The "what moved" section is fed by a rolling buffer — every event the feed
announces appends its own summary line and the report drains it — so the digest
can never disagree with what was actually posted.

### Discord — hull announcements

Earning a hull gets its own message, never batched: top priority in the embed
queue, a tier bar, the fleet-XP figure, and a scarcity line ("the **FIRST** ever
recovered", or "the 3rd ever"). The Godshard gets a distinct crown header.

### Natural citadels rendered differently on different accounts

Not a terrain bug — the seeded layout was always identical everywhere. The
fortress **artwork** was gated on per-account state:

```js
const myCit  = owned && G.hasMyCitadel(id);        // YOUR save
const rivCit = !myCit && G.rivalCitadelScore(id);  // server claim
```

`captureSystem()` writes a `state.citadels` entry only for **void** tiles, never
natural ones. So after you took a natural citadel neither branch held for you —
you saw a bare hex — while every other account read your published claim (which
does carry `citadel: true`) and saw a full red fortress. Same coordinate, two
different maps.

The fortress now draws from `t.citadel`, which is seeded terrain. Ownership only
picks the tint: **blue** yours · **red** rival or ally · **amber** unclaimed (new,
and in the legend). The `⛴` glyph is gone — the art carries that meaning, and on a
26px hex it was a third centred mark stacked on the sprite and the level label.

Natural citadels deliberately still get **no** `state.citadels` entry:
`resourceRates()` multiplies by 10 per rank for any tile that has one, and the
×1000 is already baked into `t.rate`, so an entry would hand out 10× income.

### Citadel value was misreported

Three separate bugs behind "the ×1000 isn't real after I own it":

1. **`rivalDefense()` returned a garrison for tiles you own.** The uid guard was
   `!(myUid && real.ownerId === myUid)` — when TERRITORY is offline `myUid` is
   null, so the guard passed for your own tile. The sheet's `else if (t.defense)`
   branch runs *before* the owned-citadel branch, so the fortress panel stating
   the ×1000 output was replaced by an enemy-garrison card. Now guarded on
   `isOwned(id)` first.
2. **The ×1000 comparand was implicit.** A normal tile is
   `base × rarity × typeMult` (combat ×0.4 / resource ×1 / boss ×1.5); the citadel
   branch drops `typeMult`, so ×1000 is true against a *resource-grade* tile, not
   the combat tile that was there. Now stated in code and in the UI copy
   ("×1000 vs a resource field").
3. **The income panel reported "0 citadels"** for a natural citadel you had just
   conquered, because it counted only `state.citadels`. Now counts `t.citadel` too.

### Hangar ladder — bots owned impossible fleets

Sim hull counts were capped at a hardcoded **48**. The roster has 37 hulls, five
of which are Kaevith event drops, so **32** are obtainable. `SIM_HULL_CAP` is now
derived from `CONFIG.SHIPS` at load, excluding `alienTech`, so it cannot drift
again. Bots are excluded from the Kaevith hulls on purpose — crediting them would
overstate the ceiling and imply they play an event they take no part in. A Lv 2000
★30 sim now reads 32 hulls.

### Tile sheet — the primary action was below the fold

`.sheet-actions` was the last child *inside* the scrolling `.sheet-body`, so on
any tall sheet Attack and Close scrolled off. Now sticky against the bottom of the
scrollport, with a soft fade and a hairline cue. Fixed at the primitive, so every
sheet in the game benefits.

Warp cost and garrison level moved into a compact grid directly under the sheet
head, with a third full-width cell that surfaces whatever is blocking you (empire
full, shield countdown, level lock, or the hull odds). The button now has context
without a swipe.

### Performance

- **Galaxy map** — the invasion veil was building two radial gradients per invaded
  tile per bake (~80–160 gradient objects per rebake, ~2/s idle). Now two
  pre-baked sprites blitted with `drawImage`, four phase frames for the shimmer,
  zero per-tile allocation. The bloom stays a separate unclipped additive blit so
  it still spills past hex edges and pools across adjacent invaded tiles — that
  bleed is what makes the invasion read as one field instead of separate cells.
- **Combat loop** — `nearbyEnemies()` was `filter().sort().slice()` per shot
  (multishot calls it repeatedly per frame): two array allocations and an
  O(n log n) sort over every living enemy to keep the closest 2–4. Now a single
  pass into a fixed n-slot buffer, identical output. Same for the per-frame
  `enemies.filter(...).length` zero-tests and the DPS window's `filter+reduce`.
- **Autosave** — the 8-second tick JSON-serialised the whole state unconditionally,
  including while idle on a menu. Now compares a cheap signature of the volatile
  fields first. Not a dirty flag: combat mutates xp/gold/kills every frame without
  calling `save()`, so a flag would have lost progress. While the game is actually
  running `playTime` advances every second, so it saves exactly as often as before.
- **15 background timers** now early-return on `document.hidden` — they were doing
  DOM work every 250ms–2.5s in backgrounded tabs.

### Canvas path-state fix

`ctx.beginPath()` in the fortress glow replaced the hex path with a radius-44.2
circle. The current path is **not** part of canvas drawing state, so the block's
`save()`/`restore()` never restored the hex — the prismatic `stroke()` was
outlining that circle, a rainbow ring ~1.8× tile radius bleeding over all six
neighbours. The 6-point loop is now `gxHexPath()`, re-called immediately before
the stroke. This also fixes the pre-existing case on player-built citadels.

---

## Fixed in this folder, not a code change

`js/rank-rewards.js` and `js/discord-reward.js` are referenced by `game.html` but
were **not present in v214** — they have been 404ing in production since that
release. Both are included here.

Worth a look at why: if they were dropped by a selective copy, anything else added
to `game.html` between releases is at the same risk. A `game.html`-refs-vs-folder
check before each push would catch it.

---

## Still open

- **The Stripe webhook is still not deployed.** Live payment links take money with
  nothing recording or fulfilling it. Unrelated to this release, still the most
  serious open item.
- Check last-deployed dates on the other Edge Functions: `stripe-webhook`,
  `digest-build`, `notify-unsub`, `iap-validate`, `delete-account`.
- Watch sim-held territory — `sim_behave` has no ceiling:
  ```sql
  select count(*) from public.territory where owner_id is null;
  ```
- Confirm `lf-daily-ranks` succeeded at 00:05.

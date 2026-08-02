# deploy-v208 — build 412

Push the folder contents to the repo root Vercel serves, then hard-reload once so
the `lootfleet-v412` service worker takes over.

**No SQL this release.** `territory-citadel-lv.sql` from v207 is already run.

## Changed from v207

`js/game-v93.js` only — the siege clock arming rules. Stamps bumped in all 50
cache-bust params, `LF_BUILD`, `sw.js`, `version.json` and `index.html`.

## The fix

v207 armed the clock on `playerCit || tile.void`, and only on the FINAL target.
Both were wrong:

- A **rival-held ordinary tile** (`plainTake`) is the most common PvP fight in
  the game and matched neither condition, so it was never timed. That is the
  "ENEMY CLONE FLEET with no countdown" case.
- Gating to the final target meant the clone-fleet phase of a two-phase citadel
  siege ran untimed.

Now: **every player-vs-player phase of a defended tile is timed.** The clock
arms when the encounter has a real defender — `playerCit`, any Void tile, or a
clone fleet whose `cloneDef.real` is true — and runs whenever that target is on
the field. A two-phase citadel siege gets a fresh 60s for the fortress after
their fleet goes down.

Still untimed, deliberately: escort waves before the PvP target spawns,
sparring your own garrison on an owned Boss Tile (`bossTile`), NPC citadel
siege zones, and neutral captures.

`SIEGE_CLOCK` at the top of `game-v93.js` tunes the 60.

## Discord — Void Zone

Not part of the web deploy. **Redeploy `supabase/functions/discord-feed/index.ts`**
to pick this up.

The seven Void spires now post as their own message with a full-width header,
separate from routine traffic, and never collapse into a burst line:

- 🌌 **VOID SPIRE SEIZED** — under a `# 🌌 THE VOID STIRS` header
- 👑 **THE CROWN HAS CHANGED HANDS** — VZ7, The Singularity, gets a gold embed
  and its own `# 👑 THE CROWN HAS MOVED` header
- ⚫ **VOID SPIRE RELEASED** when one goes neutral

Each carries the tile's real name and level gate (Umbral Gate 25 → The
Singularity 500), what it pays, and the 24h shield state.

## Post-deploy checks

1. Attack a **rival-held ordinary tile** — countdown appears the moment
   ENEMY CLONE FLEET spawns. This is the case v207 missed.
2. Attack a **player citadel** — countdown on their fleet, then a fresh 60s on
   the fortress.
3. Attack a **Void tile** — countdown on the Warden.
4. Attack an **NPC citadel zone** — no countdown.
5. Warp into **your own Boss Tile** — no countdown.
6. Let one expire — towed home, toast fires, 15-minute lockout on the tile.

## Known, unchanged

- `stripe-webhook` is not deployed. Payment links are live and take money with
  nothing recording or fulfilling it. Check the Stripe Dashboard directly.
- `admin_users` fails with `column reference "user_id" is ambiguous`, so the
  admin panel's Users tab is blank.

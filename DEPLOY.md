# Loot Fleet — Deploy v166 (Server Dreadnaught / Season 1: Voidmaw)

Static front-end redeploy + **ONE new database migration**. No Stripe / auth /
pricing changes. Existing saves, purchases, and all other tables are untouched.

---

## What's new in this release

**Season 1: Voidmaw — Server Dreadnaught world-boss event** (Command ▸ unlocks Lv 50)
- Global seasonal boss with endless damage stages; 2 attempts/day (+1 Pro),
  extra attempts purchasable with LootCoins (100, tripling per purchase, daily reset).
- Real battles in the zone-grind engine: manual flight only, 1× speed forced,
  3× weapon range, red blinking void-collapse zones → 5s black holes (25% hull/s).
- Grand prize: assemble the **Voidmaw** (Mothership-grade hull) from 100 parts —
  first-fight-of-day bonus, stage drops (5+), daily leaderboard ranks, ~30 days of
  consistent play. Season finals pay **Titan Sina parts**.
- **REAL cross-account leaderboards** (daily best-run + season total) via Supabase.
- Claim-based prize collection (🎁 COLLECT REWARDS button; nothing silently granted).
- Intro/how-it-works popup on first event entry; coaching for sub-50 players.

**Chroma line** (Ships tab, LootCoin fast-track)
- **Chroma Fang** — cruiser performance, ◈500.
- **Chroma Regent** — Titan Carrier performance, ◈75,000.
- Both fire full-rainbow spectrum tracers.

**Easter egg**: tap Leaderboard tab 20× in a row → password `sophie` →
free Chroma Regent + 100B of every currency (repeatable; ship grants once).

**Assets**: `ships/ship-voidmaw.png`, `ships/ship-chromafang.png`,
`ships/ship-chromaregent.png` (new). `sw.js` cache bumped to `lootfleet-v193`.

---

## 1. Database — run the new migration (REQUIRED for live event leaderboards)

Supabase Dashboard → **SQL Editor → New query** → paste
**`supabase/server-dreadnaught.sql`** → **Run**. Safe to re-run.

It creates:
- `public.sdread_scores` — one row per operator per season (name, day,
  best_day, total, stage), world-readable via RLS; **no direct writes**.
- `sdread_upsert(...)` — the only write path (identity stamped from `auth.uid()`
  server-side; best/total/stage only ever climb within a season, so a stale or
  tampering client can't wipe progress).

Without this migration the event still works — boards just show simulated
rivals ("Offline" tag) instead of real players.

## 2. Redeploy the site

Copy the contents of `deploy-v166/` over the repo → push to GitHub → Vercel
auto-deploys. (Or `vercel --prod` from the folder.)

Changed files vs v165:
- `game.html` (event screen, Command card, script tag)
- `js/server-dreadnaught.js` (NEW — the whole event)
- `js/ui-v94.js` (event routing, Voidmaw/Chroma ship cards, leaderboard easter egg)
- `js/game-v93.js` (Voidmaw boss spawn, LC ship offers)
- `js/config-v2.js` (voidmaw / chromafang / chromaregent hulls)
- `js/render.js` (rainbow tracers, new ship sprites)
- `js/cloud.js` (sdUpsert / sdDaily / sdSeason)
- `sw.js` (cache v193 + new precache entries)
- `ships/ship-voidmaw.png`, `ships/ship-chromafang.png`, `ships/ship-chromaregent.png` (NEW)
- `supabase/server-dreadnaught.sql` (NEW — migration, not served)

## 3. Smoke-test (2 minutes)

1. Hard-refresh lootfleet.com → Command menu shows the **Season 1: Voidmaw**
   card with countdown ("Ends Aug 31").
2. Open it (Lv 50+ account): intro popup appears once; FIGHT VOIDMAW deploys
   into the arena at 1× with auto-pilot hidden; red zones blink → black holes.
3. Signed-in: Leaderboards sheet shows "🌐 LIVE" once the migration is run.
4. Ships tab: Chroma Fang (◈500) + Chroma Regent (◈75,000) purchasable;
   bolts render rainbow after switching.
5. Voidmaw card in Ships tab shows "SEASON 1 EXCLUSIVE — cannot be bought"
   with a parts progress bar.

## 4. Season rollover note

Season 1 ends **Aug 31 (UTC)** — `SEASON.end` in `js/server-dreadnaught.js`.
After that date the event locks to "SEASON ENDED", season finals stage as a
claim, and pending claims remain collectible. To launch Season 2: update the
`SEASON` constant (num, boss, label, end date) and redeploy — the table keys
rows by season automatically.

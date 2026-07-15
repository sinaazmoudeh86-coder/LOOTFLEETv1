# Loot Fleet — Deploy v166 (Season 1: Voidmaw + Chroma/Frost hulls)

**Static front-end redeploy only — no new database migration in this final cut
IF you already ran `supabase/server-dreadnaught.sql`.** (It shipped mid-cycle;
verified live and working — the event boards are already ranking real players.)
No Stripe / auth / pricing changes. Existing saves and tables untouched.

---

## What's in this release

**Season 1: Voidmaw — Server Dreadnaught world-boss event** (Command ▸ Lv 50)
- Global seasonal boss, real fights in the zone-grind engine: manual flight
  only (auto-pilot disabled), 1× speed forced, 3× weapon range.
- **Stages are per-run** — every attempt starts at Stage 1; season damage still
  accumulates. Red blinking void-collapse zones → 5s black holes burning
  **75% hull/second** inside.
- 2 attempts/day (+1 Pro), extra attempts ◈100 tripling per buy, daily reset.
- Grand prize: assemble the **Voidmaw** (Mothership-grade) from 100 parts —
  first-fight-of-day bonus, stage drops (2.5–9%, stage 5+), Event Store.
- **✦ Event Coins economy**: daily ranks pay 2,500/1,500/1,000/500 ✦ (+25/15/10/5 ◈);
  season finals 25,000/10,000/5,000/2,500 ✦ (+250/100/50/25 ◈). Claim-based
  🎁 collect flow.
- **✦ Event Store** in-event: Voidmaw Shard 1,000✦, Titan Sina 2,500✦,
  Dread-class 2,000✦, Oblivion Final/Alpha/Spear 1,800/1,400/1,200✦,
  Mothership 800✦, Titan Carrier 600✦ — all land as real ship parts.
- **LIVE cross-account leaderboards** (daily best-run + season total), 5s
  auto-refresh while open, mid-run scores publish every 15s.
- Intro popup on first event entry, coaching for sub-50 players.

**New hulls**
- **Voidmaw** — Season-1-exclusive event hull (Ships tab card + parts bar).
- **Chroma Fang** ◈500 (cruiser-grade) + **Chroma Regent** ◈75,000 (Titan
  Carrier-grade) — rainbow spectrum tracers.
- **FrostyFrost** ◈50,000 (Titan Carrier-grade) — chills targets (slow),
  12% flash-freeze into an ice cube; bosses immune.
- **Marketplace "LootCoin Fleet"**: hero banners for all 4 LC-direct hulls
  (500 / 50,000 / 75,000 / 1,000,000 — full comma formatting, no level gates;
  Oblivion Final's Lv-200 gate removed).

**Misc**: Leaderboard-tab easter egg (20 taps → password `sophie` → Chroma
Regent + 100B currencies). SW cache `lootfleet-v195` with new sprites precached.

---

## 1. Database — one migration, run ONCE (skip if already done)

If you haven't yet: Supabase Dashboard → **SQL Editor → New query** → paste
**`supabase/server-dreadnaught.sql`** → **Run**. Safe to re-run; it's
idempotent.

Already ran it mid-cycle? **Nothing to do** — the deployed SQL is unchanged
since, and the live table already has real player rows.

How to tell: in the event, Leaderboards should show
"🌐 LIVE — real server standings". If it says "Syncing…" forever for a
signed-in player, the migration is missing.

## 2. Redeploy the site (GitHub push → Vercel)

Copy the contents of `deploy-v166/` over the repo → push. That's it —
`sw.js` is bumped (v195) so players pick the build up on next load without
clearing anything.

Changed vs v165: `game.html`, `sw.js`, `js/server-dreadnaught.js` (new),
`js/ui-v94.js`, `js/game-v93.js`, `js/config-v2.js`, `js/render.js`,
`js/entities.js`, `js/cloud.js`, `css/web-v89.css`,
`ships/ship-voidmaw.png` + `ship-chromafang.png` + `ship-chromaregent.png` +
`ship-frostyfrost.png` (new), `supabase/server-dreadnaught.sql` (new).

## 3. Smoke-test (2 minutes)

1. Hard-refresh → Command shows the **Season 1: Voidmaw** card + countdown.
2. Fight: deploys to the arena at 1×, auto-pilot hidden, red zones → black
   holes; every run starts at Stage 1.
3. Leaderboards: "🌐 LIVE" tag; a second signed-in account's run appears
   within ~5s while the sheet is open.
4. Event Store opens with ✦ balance; daily claim pays ✦ + ◈.
5. Market: 4 hero banners with comma prices; FrostyFrost freezes zone enemies
   (never bosses); Chroma hulls fire rainbow tracers.

## 4. Season rollover (Aug 31 UTC)

`SEASON` constant in `js/server-dreadnaught.js` (num, boss, label, end).
After end: event locks, finals stage as claims, claims stay collectible.
For Season 2 just update the constant and redeploy — `sdread_scores` keys by
season automatically.

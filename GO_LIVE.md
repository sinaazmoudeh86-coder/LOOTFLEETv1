# Loot Fleet — Go-Live Notes (current release)

You're **already live** at lootfleet.com (Supabase, Stripe, webhook, and the
original migrations were provisioned previously). This release adds **real
cross-account PvP for Fleet Rank** plus a batch of gameplay changes. There is **one
new database migration** to run; everything else is a static front-end redeploy.

---

## TL;DR

1. **Run ONE new SQL file** in Supabase → `supabase/fleet-rank.sql` (enables real PvP). §1
2. **Redeploy the site** (push to GitHub → Vercel). Ship the changed files incl. the
   bumped `sw.js`. §3
3. Smoke-test. §5

No Stripe / auth / pricing changes. Existing saves, purchases, and the other tables
are untouched.

---

## 1. Database — run the new Fleet Rank migration (REQUIRED for real PvP)

Supabase Dashboard → **SQL Editor → New query** → paste **`supabase/fleet-rank.sql`**
→ **Run**. Safe to re-run.

It creates:
- `public.fleet_ranks` — one row per operator (power, saved defense snapshot, win/loss,
  raid-protection window), world-readable via RLS (for the ladder + finding opponents);
  **no direct writes** — everything goes through functions.
- `fr_upsert_profile(...)` — registers/updates *your* row (identity stamped server-side).
- `fr_position(power)` — your global ladder position.
- `fr_targets(limit)` — real opponents nearest your power (excludes you + shielded players).
- `fr_raid(defender)` — **server-authoritative** raid: decides win/loss (your Attack vs their
  Defense), returns spoils, records W/L, gives the loser a 2-hour shield so they can't be farmed.

Trust model matches your existing `saves` table: the browser reports its own power numbers,
but **identity and raid outcomes are decided server-side**. This is the same pattern proven by
`supabase/territory.sql`.

> If you ever need to wipe the ladder, `truncate public.fleet_ranks;` is safe.

---

## 2. How Fleet Rank PvP works now (was: simulated/local)

- Fleet Rank is wired into the **real game economy**: the embed reads/writes your real
  gold + Galaxy (plasma) wallet, and your **real ship power** feeds Attack/Fleet Power.
- **Leaderboard** = the live `fleet_ranks` ladder + your real global position. The client
  blends in a few simulated whales **only** when there aren't yet 5 real players, so it's
  never empty at launch.
- **Raid targets** = real nearby operators (async PvP — you raid a snapshot of their saved
  defense; they don't need to be online). The raid outcome is resolved by `fr_raid`, the
  battle animation is driven to match, and spoils are applied to your real wallet.
- **Graceful fallback:** guests / signed-out / offline players see the original simulated
  ladder + targets, so the feature always works. (Sign in with a cloud account to go live.)

**One product note (optional):** Fleet Rank's citadel/defense *building* progress still lives
in its own `localStorage` key (`lf_fr_v2`). The competitive layer (ladder, raids, standings)
is now fully server-backed; the base-building layout is per-browser. Folding that into the
cloud save is a small front-end follow-up if you want it to roam across devices.

---

## 3. Front-end files that changed (redeploy these)

| File | Change |
|---|---|
| `fleet-rank-embed.html` | **Real PvP**: Supabase adapter (`FRNET`), live ladder + real targets + server raids, real ship power feeds Fleet Power. **Ladder UI fix**: rank emblems no longer overflow the shield; 5-digit positions/rows no longer break. **Balance**: citadel upgrades **×20**, structures + mercenaries **×10**. |
| `js/ui-v89.js` | **Command-button crash fix** (tapping Command no longer throws). **Hull-reset warnings**: every hull upgrade now shows a confirm prompt + persistent warning. **Cosmetics purchases removed** entirely (store tab + section gone). |
| `js/game-v89.js` | **Hull reset on death**: when your ship is destroyed, the active hull drops to **Lv 1** and the resources spent leveling it are forfeit. (Plus the earlier render-gate perf work.) |
| `js/render.js` | Earlier perf: hull-tint cache leak fix. |
| `game.html` | Lazy Fleet Rank iframe (earlier perf). |
| `sw.js` | Cache bumped to **`lootfleet-v105`** — **must ship** or players keep the old cached JS. |

> ⚠️ Bump `sw.js`'s `CACHE` on **every** release. Without it the service worker serves stale JS.

**Do NOT deploy `game-preview.html` / `fleet-rank-standalone.html`** — those are my in-tool
preview builds (they inline art + the embed so the sandbox can render). Production ships
`game.html` + the `js/`, `css/`, `ships/` folders and `fleet-rank-embed.html` as-is.

---

## 4. Gameplay changes in this release

- **Hull reset on death** — destroyed hull → Lv 1, invested resources lost. Players are warned
  on every upgrade (confirm prompt) and via a persistent inline note.
- **Lv 100 catastrophic item loss** — after Level 100, a destroyed ship risks your WHOLE hold:
  items are rolled one by one at half the previous chance (100% · 50% · 25% …), best gear first.
  Below Lv 100 it's the classic single-item drop. A one-time pop-up warns pilots at Lv 100.
- **Every galaxy tile now yields resources** — combat sectors pay a reduced share (×0.4) vs
  resource fields; bosses ×1.5, citadels ×100. Holding any tile produces income.
- **Costs raised** — citadel upgrades ×20; structure + mercenary deploy/upgrade costs ×10.
- **Cosmetics purchases removed** — the Cosmetics store tab and buy flow are gone (LootCoins
  still power the gear Market and convenience unlocks).
- **Fleet Rank ladder UI** — fixed broken rank emblems and row stacking.
- **Command-button crash fixed** — tapping the Command nav no longer throws.

---

## 5. Post-deploy smoke test

- [ ] DevTools → Application → Service Workers shows **`lootfleet-v105`** after one reload.
- [ ] Game boots; existing save, wallet, purchases intact.
- [ ] **Sign in with a cloud account**, open Fleet Rank (Lv 50+): the leaderboard shows a
      LIVE board, the Attack tab lists real opponents, and a raid resolves + banks spoils.
      (Open a 2nd account in another browser to see each other on the ladder.)
- [ ] Guest/offline: Fleet Rank still works (simulated ladder/targets) — no errors.
- [ ] Hull upgrade shows the confirm + warning; die in a zone → hull resets to Lv 1 with a
      notice on the wreck screen.
- [ ] Hangar has **no Cosmetics tab**.
- [ ] Citadel/structure/merc costs reflect the new higher values.
- [ ] Open a galaxy tile of type **Combat Sector** → it now shows an "Output / h".
- [ ] (At Lv 100+) the catastrophe pop-up appears once; dying lists multiple lost items.

---

## 6. What did NOT change

Stripe links + webhook, Supabase auth, the `saves` / `territory` / `wallets` tables, and
`config.live.js` are all untouched. This release only **adds** `fleet_ranks` and updates
front-end files.

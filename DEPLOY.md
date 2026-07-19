# LOOT FLEET V1.0 BETA — Deploy v166 (Season 1: Voidmaw + PvP defense + balance)

Static front-end redeploy + **up to THREE one-time SQL migrations** (run the
ones you haven't yet — all are safe to re-run). No Stripe / auth / pricing
changes. SW cache `lootfleet-v205`.

---

## 1. Database migrations (Supabase → SQL Editor → run each ONCE)

| File | What | Skip if… |
|---|---|---|
| `supabase/server-dreadnaught.sql` | Event leaderboards table + RPC | already ran it (event boards show 🌐 LIVE) |
| `supabase/server-dreadnaught-bignum.sql` | **REQUIRED FIX** — converts scores to `numeric`; endgame damage (>9.2e18) was rejected by bigint, so big players never appeared/updated on the event boards | never — run it |
| `supabase/territory-v2.sql` | **REQUIRED FIX** — the live territory table was HALF-MIGRATED (missing columns + ambiguous claim_tile overloads), so EVERY turf claim silently failed and players never saw each other's conquests. Adds columns, rebuilds ONE canonical RPC, enables read-for-all RLS + realtime. Clients also re-pull the map every 60s and republish local conquests once. | never — run it |
| `supabase/territory-defense.sql` | Adds `defense` jsonb + extended `claim_tile` — publishes each owner's fleet snapshot for the My Galaxy clone-defense feature | fine to defer: clients fall back to fleet_score-only defenders |

## 2. Redeploy the site

Push `deploy-v166/` contents to GitHub → Vercel. Players pick it up on next
load (SW v201).

## 3. What changed since the last push (full list)

**Season 1: Voidmaw event**
- Real-DB leaderboards: bignum publish fix, guest messaging ("read-only — sign
  in to publish" + once-a-day toast after guest runs), "you're the only
  operator published" note, sim-rival fallback while connecting, hung-fetch
  auto-recovery, 5s live auto-refresh, mid-run publishing every 15s.
- Per-run stages (every attempt starts at Stage 1; best stage tracked),
  black holes burn 75% hull/s, manual flight only, ✦ Event Coin economy
  (daily 2,500/1,500/1,000/500 + ◈25/15/10/5; season 25,000/10,000/5,000/2,500
  + ◈250/100/50/25), Event Store (Voidmaw Shard 1,000✦ · Titan Sina 2,500✦ ·
  Dread/Oblivion/Mothership/Titan shards), claim-based prize collection,
  game speed restored after runs (fixes "everything slow after event").

**My Galaxy — clone fleet defense (new)**
- Claims publish your fleet snapshot; rival tiles show a "⛨ DEFENDING FLEET"
  panel (their hull art + stats) BEFORE you attack.
- Taking a rival zone = escort waves → their CLONE flagship (their sprite,
  their name/score) → and if they built a citadel, "NAME'S CITADEL" phase 2.
  Neutral tiles unchanged.

**Dreadnaught Hunt**
- Hard weekly limit: the attempt is consumed ON LAUNCH (win or lose), killing
  the bail-and-refarm loophole. Gold respawns still buy attempts back.

**Ships & market**
- FrostyFrost ◈50,000 (Titan-grade cryo: chills, 12% ice-cube freeze, bosses
  immune) with ❄ banner; Titan Sina ◈1,000,000 FLAT (no level gate) with
  ✦ FINAL CLASS banner; Oblivion Final ◈300,000 (was 1M, level gate removed);
  Mothership fast-track ◈100,000; Dread-class LootCoin components rescaled
  350K–900K (were 1.5M–15M). Market shows all 5 LC banners with comma prices.

**Balance & feel (latest patch)**
- Zone-grind rebalance: mob HP baseline +27%, zones 1–25 band ~doubled, 32+
  climbs to 2.5× by ~zone 91; damage nudged up with a mild deep-zone climb.
- **Endgame DPS floor**: trash mobs floor at ~0.55s of the pilot's own DPS
  (× type HP mod) — 800B-score fleets no longer one-shot whole screens.
  Bosses ×8/×16 on top (≈4.5–9s fights); citadels clamped to ~45s of DPS.
  Kill XP/gold unchanged, so farm rate cools naturally.
- High-speed smoothness: adaptive sim stepping (≤35ms sub-steps), projectile
  trails sub-sampled (no more dotted tracers), FrostyFrost cryo visuals calmed
  + 5s refreeze immunity (the "ghost ships flickering" at 3×+).

**Home Citadel (NEW — Command · Lv 35)**
- Tower-defense waves that PERMANENTLY raise passive AFK production — pays
  only existing currencies (gold → ore/fuel @W5 → plasma @W15 → ◈ prism @W40),
  ◇ cores + real Shipworks part crates every 10th wave (Rare→Epic→Legendary→
  Dread-class), ×2 everything past Wave 100. Storage-capped (8→24h via Silo);
  4 buildings (Mining Array / Deep Silo / Defense Grid / Repair Bay).
- Wave fights: canvas defense — turrets + fleet auto-fire, tap = fleet strike;
  enemy strength scales off the pilot's own DPS. Fail = mining offline until
  repair (timer or gold), wave progress never lost.

**My Galaxy — shared-world fixes**
- ALL players now see the SAME map: the simulated-rival layer is a pure
  function of (tile, UTC day) when the shared turf war is live — identical on
  every client, shifting daily; random local sim mutations disabled. Real
  claims still override everything.
- Defending-fleet panel always shows the owner's REAL ships now: claims without
  a defense snapshot reconstruct the fleet from the owner's public leaderboard
  row (flagship + escorts), marked "scouted"; the clone battle spawns those
  exact hulls.

**Ships tab — one card design**
- Every hull's detail sheet now uses the SAME layout (icon · name+chip · class
  · layout chips · desc · mod chips · one status strip · action) — Season 1 /
  mission / LootCoin / Dread-class / construction hulls included; stale "own
  the previous ship" copy is gone.

**QoL / fixes**
- **Pro / progress loss FIX (critical)**: cloud sync no longer blind-overwrites
  — saves merge by newest, entitlements (Pro time, purchases, owned ships,
  blueprints, cosmetics) union so they can never regress; cloud writes are
  blocked until the cloud copy is verified-fetched; push debounce 30s→8s with
  flush on hide/close and instantly after any purchase. Fixes "Pro gone after
  24h" and "event coins/credits wiped next day".
- **Blueprints simplified**: no prior-hull requirement anywhere — recover the
  blueprint + hit the kill count with ANY ship (total kills). Oblivion-class
  construction gates and citadel blueprint drops follow the same rule.
- **Moon production ×10** across every mine (Ore 140/h base, Fuel 200/h,
  Plasma 90/h, Gold 2,600/h, Prism 6/h).
- **Legibility pass**: global type floor raised (~+1px everywhere, prose
  ≥12.5px); Voidmaw banner & hangar reward cards rewritten — shorter copy at
  13px instead of the old 10–11px paragraphs.
- WASD + arrow-key flight on desktop (takes over from auto-pilot, releases on
  blur, never fires while typing).
- Adaptive sim stepping: 4×/5×/10× speed no longer runs 4/5/10 full sim passes
  per frame — smooth movement at high speed, same wall-clock speed.
- Flicker fixes: leaderboard 4s refresh diffs before repainting; missions
  countdown ticks in place; moon-colony upgrades keep the live diorama canvas.
- Prism mining: orphaned-run guard (frozen PRISM pill / invisible mining after
  zone changes) + event no longer leaves the game stuck at 1×.
- First-login name gate: brand-new accounts pick their commander name as their
  first action (once ever; veterans skipped).

## 4. Smoke-test (90s)

1. Event ▸ Leaderboards: 🌐 LIVE; a signed-in friend's run appears in ~5s
   (after the bignum migration).
2. My Galaxy ▸ tap a rival tile: ⛨ DEFENDING FLEET panel; attack → clone
   flagship uses their hull art.
3. Dread Hunt: deploy a tier, bail — it's locked for the week.
4. Market: 5 banners (500 / 50K / 75K / 300K / 1M), comma-formatted.
5. Desktop: WASD flies the ship; 5× speed feels smooth (continuous tracers,
   no ghost strobing); zone mobs take several volleys even with an endgame fleet.

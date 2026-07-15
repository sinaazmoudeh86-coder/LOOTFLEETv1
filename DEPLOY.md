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

**QoL / fixes**
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

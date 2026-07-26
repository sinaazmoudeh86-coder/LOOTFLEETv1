# LOOT FLEET V1.0 BETA — Deploy v202 (build 395 · SW cache `lootfleet-v395`)

Push this folder to GitHub → Vercel. Balance + bug release on top of v201.

## Database

One NEW file in this release, and it should be run — the simulated roster's kill
counts are visibly wrong on the live board until it is:

| # | File | Gives you |
|---|---|---|
| 1 | `supabase/sim-kills-sanity.sql` | **NEW** — caps simulated kill counts at a human-plausible career total (trigger + one-off backfill) |

Everything from v201 is unchanged and already run:
`pilot-ascension.sql`, `simulated-pilots.sql`, `simulated-pilots-behavior.sql`,
`sim-board-bignum-fix.sql`. All are idempotent — safe to re-run.

### Still outstanding (not in this folder)
The alliance boss RPC `alliance_attack` clamps transmitted damage at **25× power**
server-side. The client no longer caps damage at all (see below), so raise or drop
that clamp wherever the alliance schema lives, or the payout won't match the meter
players watch fill.

---

## What shipped in this release

### Lifesteal — cut 80% across the entire game
Sustain had become the dominant stat, and in siege combat it made *both* fleets
unkillable: five-minute stalemates where nobody could die.

* Item rolls 1–5% → **0.2–1%**; plasma weapon-class bonus 1–2% → **0.2–0.4%**.
* All 13 hull `lifeSteal` mods scaled (Titan Sina 146 → 29.2, Dread Omega 73 →
  14.6, Oblivion Spear 9 → 1.8, …).
* Skill tree 1%/rank → **0.2%/rank**. Pilot tree node roll 0.6–1.4% → **0.12–0.28%**.
  Vampiric Engine legendary 4% → **0.8%**.
* Global ceiling **95% → 19%**. PvP ceiling **5% → 1%**, plus no single hit can
  siphon more than 6% of your hull.
* One-time save migration scales lifesteal already rolled onto equipped gear, bag
  items and every escort loadout — no pre-nerf fitting survives.

### Pilot Ascension — the whole hangar comes with you
Was: one Legacy Ship survived. Now: **every hull you own stays owned**, event and
premium hulls included. Each one resets — upgrade levels wiped, fittings cleared,
cargo gone; per-hull ascension-module stars survive. Step 1 of the flow is now a
**flagship** pick (which hull you warp out flying), the wing disbands, and escort
slots re-earn with pilot level.

### Void Zone — unwinnable spires fixed
Three compounding causes, all addressed:

* Void Warden power scaled with tile tier (×2.8 at Lv 400), which after true-power
  conversion made deep spires mathematically unwinnable. Now a flat ×1.15 with a
  1.35 ratio ceiling; all clone fights are capped at ×6.
* Defending-fleet repair was 5%/s of a 110-second hull — it out-healed everything.
  Now an absolute HP/s figure, hard-capped at 15% of the attacker's DPS and
  **suppressed for 2.5s after every hit**, so damage always shows.
* Attacking a held tile and bailing showed it as NEUTRAL — unclaimed for 24h and
  stripped of its garrison. The attack shield no longer blanks the tile's holder;
  only a real capture does.

### Alliance boss — no damage limit
The 25×-power transmit ceiling is gone client-side: damage counts uncapped, the
"TRANSMIT BUFFER FULL" banner is removed, and a run is worth
`max(25× power, 2.4× the remaining pool)` — so a hull you can't dent no longer
exists, and a heavy hitter flattens low marks in a hit or two.

### Simulated pilots — no longer identifiable at a glance
* Kill counts were the tell (billions, on Level-1 rows). Kills are now a career
  stat — 900 per level, each ascension star worth a 500-level career — clamped on
  read *and* enforced server-side by `sim-kills-sanity.sql`.
* Dropped the "xXpilot"-shaped name pattern.

### Galaxy Supply
Cosmic Cache tops out at **Artifact** again. The crate ceiling read "last rarity in
the chain", which silently became Paragon once the ascension-exclusive tiers were
appended. Ascendant / Celestial / Paragon are earned by ascending only.

## Smoke test (2 min)
1. Hangar ▸ stats: Life Steal reads a decimal (e.g. `0.4%`), not `0%`.
2. Galaxy Supply ▸ Cosmic Cache chip says **Artifact chance**, and the odds bar's
   top segment is Artifact red.
3. Void Zone ▸ any tier: warp in, enemies take and deal damage; no stalemate.
4. Attack a rival/NPC tile, bail — the tile still shows its holder, shielded 24h.
5. Command ▸ Pilot Ascension: hero line reads "You keep **every ship**", Step 1 is
   CHOOSE YOUR FLAGSHIP.
6. Alliance ▸ raid: the ⚔ meter has no `/ cap` denominator.

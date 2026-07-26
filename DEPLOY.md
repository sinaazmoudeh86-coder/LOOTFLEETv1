# LOOT FLEET V1.0 BETA — Deploy v201 (build 348 · SW cache `lootfleet-v348`)

## ⚠ RUN ONE SQL MIGRATION: `supabase/save-cas.sql`

This release fixes the duplicate-login corruption at the root, and the fix needs
a database change. Until you run it the client silently falls back to the old
last-write-wins path (no crash, no benefit).

**What it does:** adds `saves.rev`, a `save_conflicts` quarantine table, and
four RPCs — `save_pull` / `save_push` (compare-and-set), `claim_session` /
`touch_session` (server-timestamped session lease).

### Why duplicate logins still corrupted saves
Every protection we had ran when a device *read* the cloud. Nothing guarded the
*write*: `saves` was a blind upsert, so two signed-in devices were pure
last-write-wins — whichever pushed second erased everything the other did since
it booted. Four smaller holes fed it: the tab didn't pin its account (a second
login in another tab re-pointed the save key mid-session, writing account A's
state into account B's slot), a kicked tab kept simulating so players banked
progress that could never be saved, kick arbitration compared `Date.now()`
across devices (a skewed clock could never be kicked), and the lock rode on
ephemeral broadcasts a sleeping device simply missed.

### The fix
- **Compare-and-set writes.** Every save carries the revision it was based on.
  A push from a stale revision is REFUSED and handed the row it missed; the
  client merges, retries, and only then commits. Unseen work can't be erased.
- **Conflict quarantine.** When two timelines merge, the losing copy is written
  to `save_conflicts` (and `lf-conflict::<uid>` locally). Nothing is destroyed.
- **Server-time session lease.** `active_sessions` is now claimed and renewed
  through RPCs that stamp with Postgres `now()`; clients subscribe to the row
  (persisted — survives sleep/reconnect) and the 20s heartbeat doubles as a
  poll. Client clocks no longer decide anything.
- **Pinned account per tab** — a tab serves one account for its life; a
  different login elsewhere freezes it with an explicit notice.
- **Kicked screens freeze the simulation**, not just saving.
- Live merges are adopted into the running game (`GAME.adoptSave`), so play
  continues on the merged save instead of a superseded copy.

Push this folder to GitHub → Vercel. **No new SQL migrations** — the schema is
unchanged from v200 (build 346). If you skipped earlier releases, run the
migrations listed in `deploy-v200/DEPLOY.md` first.

## What this release is

v201 is a **reconciliation build**. Two lineages of the game had drifted apart:
the deployed line (v168 → v200: alliances, social, mail, redeem, Void Zone,
Monolith hulls) and the working line (Starforge, lifetime badges, mission
tiers, save-sync fixes). Everything now lives in one tree.

### Recovered — features that were missing from the working build
- **Void Zone** — 7 apex turf-war tiles beyond the rim (Lv 25/50/100/200/300/
  400/500), 1000× entry toll, 100× yield, citadel included with the conquest,
  Void Warden garrisons, marathon sieges, black-hole arena dressing.
- **Alliances + Hollow Armada raid** (`alliance.js`, `alliance-boss.js`),
  **Social**, **Mail** (war reports, season/daily prize delivery), **Redeem
  codes**.
- **Monolith hull line** (Shard / Bastion / Siegebreaker / Apex) + the
  `MONO_MULT` siege bonus vs boss-class targets.
- Engine: smooth-aim v2, smooth camera glide, safe-hangar routing after every
  event exit, fleet-wide FrostyFrost cryo, citadels captured **intact** (one
  rank down, under your flag), resource settlement on every ownership change,
  extended number ladder (…Dc → Vg), pilot-tree zoom, Home Citadel towers.

### Kept — work from the newer working line
- **Starforge** (Command ▸ Starforge, Lv 100) — temper +1→+15, forge heat pity,
  slip risk past +10, purity rerolls (60–130%), costs scaling with rarity and
  item level (ILVL 300+ tariff), +15 grants 1% flash-freeze per fitting.
- **Lifetime badges** (`achievements.js`) — 15 career chains, 1,000 ranks,
  Titan Sina at full completion; **mission tiers** (daily/weekly/monthly).
- **Save-sync fixes** — progress-weighted merge (a weaker device can no longer
  clobber a stronger save), best-ever save vault, in-app **Save recovery**
  (Account ▸ Save recovery), repair push when local beats cloud.
- **Shipworks Shard Exchange** (10:1 up the hull chain) + buffed crate rewards.
- **XP band pass** — 100s ×2, 200s ×3, 300s ×6, 400s+ ×10 on top of the curve.
- High-speed flash smoothing on damage, Pro badge nebula/comet styling.

## Smoke test (90s)
1. Command menu shows **Void Zone** and **Starforge** (🔒 Lv 100 under level).
2. Void Zone ▸ tap a spire — level gate, toll and Void Warden intel all render.
3. Starforge ▸ pick a fitting — temper odds, rarity/ILVL cost badges, purity.
4. Missions ▸ Daily / Weekly / Monthly / ⌘ Badges tabs all populate.
5. Account ▸ Save recovery lists save copies with a Restore button.
6. Mail + Social + Alliance screens open; a rival tile loss files a war report.

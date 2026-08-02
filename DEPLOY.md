# deploy-v210 — build 414

**Supersedes v208 and v209.** If you haven't pushed those, push this instead —
it contains everything they had.

## Order

1. Run `supabase/war-events.sql` in the SQL Editor
2. Push the folder contents to the repo root Vercel serves, hard-reload once
3. Redeploy `supabase/functions/discord-feed/index.ts` in the Edge Function editor

Steps 1 and 3 are both required for defence announcements. The feed runs fine
without either — it just won't post them.

## Changed from v209

`js/game-v93.js`, `js/territory.js`, plus the Edge Function and one new SQL file.
Stamps bumped in all 50 cache-bust params, `LF_BUILD`, `sw.js`, `version.json`
and `index.html`.

## Successful defences now post to Discord

🛡️ **DEFENCE HELD** — *"Falcor held Korar ε-9 · realsina1 couldn't finish it
inside 60 seconds. The Rank 3 Citadel never fell."*
Void tiles get 🛡️ **VOID SPIRE HELD**.

### Why this needed a table

Every other event in the feed is found by diffing `territory`, `leaderboard` and
`alliances` — that catches anything where state changes hands. A successful
defence is the one thing that changes nothing: the clock runs out, the defender
keeps the tile, and the row is byte-for-byte identical to a minute ago. There is
no diff to find.

So the attacker's client reports it through `log_repelled()`, and the feed drains
the log on an id high-water mark. The RPC is deliberately narrow:

- the **attacker** is `auth.uid()`, never taken from the client
- the **defender** is read from `territory` server-side, never taken either
- one row per attacker, per tile, per minute

A forged call can only credit *somebody else* with a successful defence, which
nobody gains from faking. Rows older than 30 days are cleared on each run of the
SQL.

## Post-deploy checks

1. Attack a rival-held tile and let the clock expire. Within two minutes Discord
   should show 🛡️ DEFENCE HELD naming both pilots.
2. Immediately retry the same tile — the 15-minute shield should block you, and
   no second Discord post should appear.
3. `select * from war_events order by id desc limit 5;` — one row per repel.
4. Time out on a Void tile — the embed should read VOID SPIRE HELD.

## Also in this build (from v209, unpushed)

- **Timeout = the defender won.** Their fleet stays on the field; the attacker is
  towed out under invulnerability. Nothing is deleted.
- **Territory survives ascension.** Tiles, Void spires and Citadels ride across;
  the next republish writes your new lower fleet score onto them.

## Discord (from v208, unpushed)

Void spires post as their own message with a full-width header — 🌌 VOID SPIRE
SEIZED, and 👑 THE CROWN HAS CHANGED HANDS for VZ7.

## Known, unchanged

- `stripe-webhook` is not deployed. Payment links are live and take money with
  nothing recording or fulfilling it. Check the Stripe Dashboard directly.
- `admin_users` fails with `column reference "user_id" is ambiguous`, so the
  admin panel's Users tab is blank.

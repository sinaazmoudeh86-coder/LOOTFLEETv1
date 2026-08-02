# deploy-v211 — build 415

**Supersedes v208, v209 and v210.** Push this one; it contains everything they had.

---

## The three steps

### 1 · Run the SQL

Supabase → **SQL Editor** → **New query** → paste `supabase/war-events.sql` → **Run**.

Creates the `war_events` table and the `log_repelled()` RPC. Without it,
successful defences can't be announced (everything else still works). Safe to
re-run.

### 2 · Push the site

Push the contents of this folder to the repo root Vercel serves. Then open the
game and **hard-reload once** so the `lootfleet-v415` service worker takes over.

### 3 · Redeploy the Discord function

Supabase → **Edge Functions** → **discord-feed** → **Code** → select all, delete,
paste `supabase/functions/discord-feed/index.ts` → **Deploy**.

Secrets, the Verify JWT setting and the cron job are untouched — you're only
swapping code.

**Confirm all three:**

```sql
select id, status_code, content, created
  from net._http_response order by created desc limit 3;
```

`200` with `{"ok":true,...}` means the new function is live. If `content`
mentions `war_events`, step 1 didn't run.

---

## What's in it

### Discord — battles read as fight cards

Small line names the arena, big line names the fight and the winner:

```
⚔️  BATTLE FOR KORAR ε-9
🏆 REALSINA1  ⚔  FROSTSKULL — REALSINA1 TAKES IT

🛡️  BATTLE FOR VELAR DRIFT
🛡️ FALCOR  ⚔  REALSINA1 — FALCOR HOLDS
```

Winner always leads, so the result reads without parsing a sentence. Defences put
the defender first — they won. Names uppercase, capped at 18 chars so long ones
can't break the card.

**Every tile taken off another pilot gets its own card**, fortress or not. Only
quiet bulk activity collapses into a summary line — first claims on empty space,
and releases. Battles never do.

Detail line per outcome: 💥 Citadel razed · 🏰 Rank 3 Citadel taken intact ·
🛰️ No fortress here, open ground · ⏱️ ran the clock out, 60 seconds, no breach.

### Discord — successful defences

🛡️ **DEFENCE HELD** (🛡️ **VOID SPIRE HELD** in the Void Zone).

A successful defence is the one event that changes nothing in the database — the
clock expires, the defender keeps the tile, the row is byte-for-byte identical.
There's no diff to find, so the attacker's client reports it through
`log_repelled()`. The RPC trusts almost nothing from it: attacker is
`auth.uid()`, defender is read from `territory` server-side, one row per
attacker per tile per minute.

### Discord — Void Zone

The seven spires post as their own message under a full-width header, never
collapsed, never sharing a batch with routine traffic. VZ7 gets gold and its own
`👑 THE CROWN HAS MOVED`.

### Game — timeout means the defender won

Nothing is deleted. Their fleet survived, so it stays on the field holding the
tile. The **attacker** leaves: spawns stop, 6s invulnerability so the clock
running out can never become a shipwreck, then a 3s tow back to My Galaxy or the
Void Zone. Tile shielded against them for 15 minutes.

### Game — territory survives ascension

Tiles, Void spires and Citadels ride across (`ownedSystems`, `citadels`,
`rivalCitadels`, `tileCd` in `ASC_KEEP`). `territory` rows are keyed by
`owner_id`, so they were always held against the account, not the fleet — the old
wipe released nothing server-side, it just desynced the client and gave away
holds nobody lost in a fight.

The cost is still real: your next republish writes the new, much lower fleet
score onto every tile you hold.

---

## Post-deploy checks

1. Attack a rival-held **ordinary** tile — countdown appears the moment ENEMY
   CLONE FLEET spawns.
2. Let it expire — **their fleet is still on screen**, you're towed out, tile
   shows a 15-minute shield.
3. Within two minutes Discord posts 🛡️ DEFENCE HELD naming both pilots.
4. Retry the same tile immediately — shield blocks you, no duplicate post.
5. Take a tile off someone — 🏆 fight card names both pilots and the system.
6. Ascend while holding tiles — still yours, Citadels at the same ranks.
7. Log out, in, and back in twice on a deep-zone account — power and gold
   identical each time.

---

## Known, unchanged

- `stripe-webhook` is not deployed. Payment links are live and take money with
  nothing recording or fulfilling it. Check the Stripe Dashboard directly.
- `admin_users` fails with `column reference "user_id" is ambiguous`, so the
  admin panel's Users tab is blank.

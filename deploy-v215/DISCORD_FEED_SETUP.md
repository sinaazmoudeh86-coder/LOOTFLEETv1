# Discord live feed — setup

One channel, fed automatically from the game database every 2 minutes.

Three files:

| File | What it is |
|---|---|
| `supabase/functions/discord-feed/index.ts` | the Edge Function that diffs tables and posts |
| `supabase/discord-feed-setup.sql` | cursor table + cron schedule |
| this doc | the six steps |

---

## What gets posted

| Event | Trigger | Colour |
|---|---|---|
| ♛ **THE THRONE** | rank #1 changes hands | violet |
| ✦ **ASCENSION** | `asc_stars` goes up | gold |
| ⚔ **ALLIANCE ARMADA** | an alliance clears a Mark | orange |
| ☠ **SEASON DREAD** | a pilot beats their best stage | crimson |
| ▲ **TOP TEN** | a pilot enters the top 10 | green |
| ◈ **DEEP ZONE** | zone 10/25/50/75/100/125/…/500 | cyan |
| ⬡ **MILESTONE** | level 25/50/75/100/…/500 | blue |
| ⬢ **ALLIANCE FORMED** | a new alliance appears | green |
| ▸ **NEW PILOT** | a new leaderboard row | slate |

Each is a coloured embed with a category label, a headline, and a dim `-#` subtext line carrying power/zone/level — the same hierarchy as the dispatch email. Numbers use the game's own suffix ladder (`63.3B`, `1.1Sx`) so Discord and the HUD always agree.

More than 10 events in one tick, and the top 10 by priority post as embeds while the rest collapse into one `…and 4 more:` line. The channel never floods.

---

## Steps

### 1. Make the Discord webhook

Server Settings → **Integrations** → **Webhooks** → **New Webhook**. Point it at your feed channel, name it *LootFleet*, **Copy Webhook URL**.

> Treat that URL like a password. Anyone holding it can post as the bot indefinitely. It never goes in client JS — that's the whole reason this runs server-side.

### 2. Install the CLI and link the project

```bash
npm i -g supabase
supabase login
supabase link --project-ref emldvvlaanyivpmxyylr
```

### 3. Set the secrets

`FEED_KEY` is any long random string you invent — it stops strangers triggering the endpoint. Keep a copy, step 5 needs it.

```bash
supabase secrets set DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…"
supabase secrets set FEED_KEY="paste-a-long-random-string-here"
```

### 4. Deploy

```bash
supabase functions deploy discord-feed --no-verify-jwt
```

`--no-verify-jwt` is required — cron calls it with a shared key, not a user token. The function rejects anything without the right `x-feed-key`.

### 5. Run the SQL

Open `supabase/discord-feed-setup.sql`, replace `<PROJECT_REF>` with `emldvvlaanyivpmxyylr` and `<FEED_KEY>` with your step-3 string, then paste the whole file into **SQL Editor → New query → Run**.

### 6. Watch the first two ticks

The **first** run posts one line — *⚡ FLEET DISPATCH IS LIVE* — and silently records the current state of all 15 pilots, 4 Dread entries and 2 alliances. That's deliberate: without it your channel would open with a wall of backdated history.

From the **second** tick on, only genuine changes post. Ascend a test account to see it fire.

---

## If nothing shows up

```sql
select status, content, created from net._http_response order by created desc limit 5;
```

- **200** — the function ran. `content` shows `{"ok":true,"events":0}` when there was simply nothing new.
- **403** — the `x-feed-key` in the cron job doesn't match the `FEED_KEY` secret.
- **500** — read `content`; it names the failure (usually a missing secret).
- **no rows at all** — the cron job isn't scheduled. `select * from cron.job;`

---

## Notes

**Simulated pilots are excluded.** The feed reads `leaderboard`, and the sim population lives in `sim_pilots`. Nothing fake is ever announced. Side effect worth knowing: in-game ranks interleave sim rivals, so Discord's "#1" is the top *human*, and the two can disagree. Say so in the channel topic, or leave it — it reads as a human-only hall of fame either way.

**Save-only events can't be announced yet.** Moon Colony, Void Zone, and rare drops live in each player's local save, not a server table — the same gap the dispatch email hit. They need a server-side write before the feed can see them.

**Cost is nil.** ~720 invocations/day against a 500K free-tier limit.

**Latency.** Up to 2 minutes. If you want a Voidmaw kill to land instantly, a Postgres trigger with `pg_net` posting straight to the webhook fires in under a second — worth adding for one or two rare events, not for everything.

**Adding an event** is one block in `index.ts`: add the field to that entity's `cur` snapshot, compare against `was`, and push an embed. The cursor handles the rest.

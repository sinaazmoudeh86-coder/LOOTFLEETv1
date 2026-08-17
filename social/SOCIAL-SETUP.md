# LOOT FLEET — auto social posting (Buffer pipeline)

Content flows: **batch JSON → rendered PNG cards (hosted on the game site) → `social_queue` table → cron Edge Function → Buffer → Instagram / TikTok / Facebook.**

## Easiest path: the setup helper
Open **social/admin.html** from the project preview (it is a LOCAL tool — never publish it; keep it out of the deploy folder). Enter your project ref + service_role key, press **LIST BUFFER CHANNELS**, copy the id string into the `BUFFER_CHANNEL_IDS` secret, then press **TEST RUN** — `{"due":0,"report":[]}` means healthy.

## One-time setup (~15 min)

1. **Buffer side** — connect Instagram, TikTok and Facebook as channels in Buffer, then create an API key at `publish.buffer.com/settings/api` (API is on every plan, incl. Free).
2. **Run `supabase/social-queue.sql`** in the SQL editor. Seeds batch 01: 20 posts, 2/day (15:00 & 23:00 UTC), starting tomorrow. Verify row says `queued: 20`.
3. **Deploy the Edge Function** `social-post` and set secrets:
   `BUFFER_API_KEY` · `BUFFER_CHANNEL_IDS` · (`SB_URL` / `SB_SERVICE_KEY` if not auto-injected).
4. **Find channel ids**: invoke the function once with `?channels=1` — it returns your Buffer channels; put the three ids (comma-separated) in `BUFFER_CHANNEL_IDS`.
5. **Schedule the cron** (every 15 min) — snippet is at the top of `functions/social-post/index.ts`.
6. **Push the site** — the PNGs live at `social/png/` in the deploy folder, so they're served at `lootfleet.com/social/png/<slug>.png`. Buffer fetches them from there. **The site push must happen before the first due_at.**

## Ongoing (per release / per batch)

- Ask Claude for a new batch: cards are authored in `social/batch-XX.json`, rendered by `social/cards.html`, snapshotted to `social/png/`, and a seed insert is appended to the queue. Captions and schedule ride in the same file.
- Nothing else to touch — the cron drains whatever is queued.

## Operations

- **Pause everything**: `update social_queue set status='skipped' where status='queued';`
- **Retry a failure**: fix the cause, then `update social_queue set status='queued' where slug='...';` — channels that already posted are recorded in `buffer_ids` and are skipped on retry, so no double-posts.
- **Reschedule**: just edit `due_at`.
- **Health check**: `select slug, status, due_at, error from social_queue order by due_at;`

## Safety properties

- Rows are claimed before Buffer is called — a crashed run can't double-post.
- Max 4 posts per cron tick — a backlog drains gently, far under Buffer's rate limits.
- The queue table is service-role only; game clients can't see or touch it.
- Per-channel Buffer post ids are stored on the row for auditability.

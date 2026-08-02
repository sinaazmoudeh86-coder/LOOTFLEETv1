-- =============================================================================
--  discord-feed-setup.sql — cursor table + 2-minute schedule
--  Run once in Supabase → SQL Editor. Safe to re-run.
--
--  Deploy the Edge Function and set its secrets BEFORE running the cron block
--  at the bottom, otherwise every tick logs a failed request.
--  Full walkthrough: DISCORD_FEED_SETUP.md
-- =============================================================================

-- ---- 1. CURSOR --------------------------------------------------------------
-- One row per watched entity holding the last-announced snapshot. The function
-- diffs live rows against this, so a missed tick self-heals on the next run and
-- nothing is ever announced twice.
create table if not exists public.feed_seen (
  kind       text not null,          -- 'pilot' | 'dread' | 'alliance' | '_meta'
  ref        text not null,          -- user_id, alliance_id, or a meta key
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- Service role reaches this from the Edge Function; nobody else needs it.
alter table public.feed_seen enable row level security;
revoke all on public.feed_seen from anon, authenticated;

-- ---- 2. EXTENSIONS ----------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ---- 3. SCHEDULE ------------------------------------------------------------
-- EDIT THESE TWO LINES before running:
--   <PROJECT_REF>  your project ref (Settings → General)
--   <FEED_KEY>     the same value you set as the FEED_KEY secret
--
-- Every 2 minutes. Discord's webhook limit is 5 posts / 2s, and one tick sends
-- at most one message, so this never approaches the ceiling.
select cron.unschedule('discord-feed')
  where exists (select 1 from cron.job where jobname = 'discord-feed');

select cron.schedule(
  'discord-feed',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/discord-feed',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-feed-key',   '<FEED_KEY>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- ---- CHECKS -----------------------------------------------------------------
-- Is it scheduled?
--   select jobname, schedule, active from cron.job where jobname = 'discord-feed';
--
-- Did the last few runs succeed? (status should be 200)
--   select status, content, created
--     from net._http_response order by created desc limit 5;
--
-- What is the feed tracking?
--   select kind, count(*) from public.feed_seen group by kind;
--
-- Replay everything from scratch (clears the cursor — the next tick re-bootstraps
-- silently rather than dumping history into the channel):
--   truncate public.feed_seen;
--
-- Pause without deleting:
--   update cron.job set active = false where jobname = 'discord-feed';

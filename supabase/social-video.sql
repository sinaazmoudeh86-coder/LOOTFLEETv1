-- =============================================================================
--  social-video.sql — VIDEO POSTS IN THE SOCIAL QUEUE        (run once)
-- -----------------------------------------------------------------------------
--  The queue was built for rendered PNG cards: one `image_url`, and the Edge
--  Function hands Buffer `assets: [{ image: { url } }]`. Video is a different
--  asset shape and, on Facebook and Instagram, a different POST TYPE — a reel is
--  not a photo post with a moving picture in it.
--
--  ADDITIVE ONLY. `video_url` and `thumb_url` are nullable, so every existing
--  queued row keeps working untouched and the function decides per row which
--  kind of post it is. Nothing is renamed, nothing is dropped: the twenty PNG
--  posts already sitting in this table must survive a migration that is about
--  something else entirely.
--
--  Safe to re-run.
-- =============================================================================

alter table public.social_queue add column if not exists video_url text;
-- Facebook and Instagram both want a poster frame. Without one they pick a frame
-- themselves, and on a cold open — which is the whole point of these cuts — the
-- frame they pick is a dark starfield. A named thumbnail is not decoration.
alter table public.social_queue add column if not exists thumb_url text;

-- A row is a video post if it has a video_url. Stated as a generated column so
-- the report queries below and the Edge Function agree on the definition rather
-- than each re-deriving it.
alter table public.social_queue drop column if exists kind;
alter table public.social_queue add column kind text
  generated always as (case when video_url is not null then 'video' else 'image' end) stored;

-- `image_url` WAS NOT NULL, because when this table was built every post was a
-- rendered PNG card and an image was the only thing a row could carry. A video
-- row has no image, so the column constraint has to widen before the table can
-- hold one.
--
-- This LOOSENS a constraint and therefore cannot invalidate an existing row:
-- every row already in the table has an image_url and keeps it. The guarantee it
-- used to provide — "a row always has media" — is not lost, it moves one line
-- down to a check that accepts either kind.
alter table public.social_queue alter column image_url drop not null;

-- A post must carry SOMETHING to post. Without this, a row with neither a card
-- nor a video would claim itself, call Buffer with an empty asset, fail on every
-- channel, and land in `failed` with a Buffer error rather than the real reason.
alter table public.social_queue drop constraint if exists social_queue_has_media;
alter table public.social_queue add constraint social_queue_has_media
  check (image_url is not null or video_url is not null);

create index if not exists social_queue_kind_due on public.social_queue (kind, due_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- SEED — the Dreadnaught Hunt cut
-- ---------------------------------------------------------------------------
-- due_at is UTC. 23:00 UTC is 6pm ET / 3pm PT — the evening slot the PNG batches
-- already use, so the video does not land on top of a card.
--
-- ON CONFLICT DO NOTHING keyed on slug: re-running this file cannot double-post.
insert into public.social_queue (slug, caption, video_url, thumb_url, due_at, status)
values (
  'dreadnaught-hunt-15s',
  E'One attempt per tier, per week. That is the whole Dreadnaught Hunt.\n\n'
  || E'Tier 14 hits like a wall — telegraphed novas, a 90-second window, and a fleet that has to hold position through all of it. Clear it and you get one ◇ Dread Core.\n\n'
  || E'Cores buy nodes on the Pilot Tree, and the tree is the one thing in the game that survives ascension. Everything else resets. That is why people show up on Mondays.\n\n'
  || E'Free in your browser — no install, no account needed to start.\nlootfleet.com',
  'https://lootfleet.com/social/video/dreadnaught-hunt-15s.mp4',
  'https://lootfleet.com/social/video/dreadnaught-hunt-15s.jpg',
  (current_date + interval '1 day' + interval '23 hours'),
  'queued'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- CHECK
-- ---------------------------------------------------------------------------
select slug, kind, status, due_at,
       coalesce(video_url, image_url) as media
  from public.social_queue
 order by due_at;

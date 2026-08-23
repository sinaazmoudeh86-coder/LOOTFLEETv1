-- =============================================================================
--  social-storage.sql — PUBLIC BUCKET FOR SOCIAL VIDEO       (run once)
-- -----------------------------------------------------------------------------
--  WHY NOT THE SITE. Serving social media from the game site couples a post to a
--  deploy: the file only exists once someone pushes, and a push that lands late
--  is a post that silently never happens (Buffer fetches the URL, gets a 404,
--  and the network drops it with nothing in our logs). Storage decouples them —
--  the video studio uploads straight here and the queue points at this URL, so
--  publishing a video touches nothing the players are running.
--
--  PUBLIC READ IS REQUIRED, NOT A SHORTCUT. Buffer, Facebook and Instagram fetch
--  the asset anonymously from their own infrastructure; there is no way to hand
--  them a credential. The bucket therefore contains only what is already meant
--  to be seen by the whole internet — finished marketing cuts and their poster
--  frames. Nothing else may be written here.
--
--  WRITES ARE SERVICE-ROLE ONLY. The studio page holds the service key in the
--  operator's own browser (same as social/admin.html); no game client has it,
--  and the anon role gets read and nothing more.
--
--  Safe to re-run.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social', 'social', true, 104857600,
        array['video/mp4','image/jpeg','image/png'])
on conflict (id) do update set
  public = true,
  -- 100MB: a 15s cut at 12 Mbps is ~22MB, so this is generous headroom for a
  -- longer piece without being a place someone can park an arbitrary file.
  file_size_limit = 104857600,
  allowed_mime_types = array['video/mp4','image/jpeg','image/png'];

-- ---- read: anyone. See the note above — this is how the networks fetch. -----
drop policy if exists "social read" on storage.objects;
create policy "social read" on storage.objects
  for select using (bucket_id = 'social');

-- ---- write: service_role only ----------------------------------------------
-- No insert/update/delete policy is created for anon or authenticated, so those
-- roles are refused by default. service_role bypasses RLS entirely, which is the
-- studio page's upload path.
drop policy if exists "social write" on storage.objects;

-- ---- CHECK -----------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'social';

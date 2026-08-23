/* =============================================================================
   social-upload.js — RECORD → POSTER → STORAGE → QUEUE, in one press
   -----------------------------------------------------------------------------
   The manual pipeline was: record, convert, cut a poster frame in ffmpeg, name
   both files exactly right, push them to the site, verify the URL, then run a
   SQL insert. Seven steps, six of them clerical, and every one of them a place
   to typo a slug that nothing validates until a post silently fails to appear.

   This does all of it from the page that already owns the pixels.

   THE POSTER FRAME IS CAPTURED DURING THE TAKE, not seeked to afterwards. The
   recorder simply calls grab() as the clock passes the chosen second, so the
   still is byte-for-byte a frame that is actually in the video — no re-render,
   no risk of the seek landing on a different frame than the encoder saw.

   UPLOADS GO TO SUPABASE STORAGE, NOT THE SITE. That is the point: pushing the
   game site to publish a video couples a social post to a deploy, and a deploy
   that lands late is a post that never happens. Storage is a public bucket with
   its own URL, so the two are independent.

   THE SERVICE KEY NEVER LEAVES THE BROWSER. It is held in localStorage on the
   operator's machine, exactly as social/admin.html already does. This file must
   never be copied into a deploy folder — it is a local tool.
   ========================================================================== */
(function () {
  'use strict';
  var K_REF = 'lfSocialRef', K_KEY = 'lfSocialKey';
  var BUCKET = 'social';


  // The UI lives in js/studio-page.js now. This file is transport only —
  // uploads and the queue upsert — so a second studio surface (a batch runner,
  // a CI job) can use it without inheriting a panel it does not want.

  // ---- upload + queue -------------------------------------------------------
  async function put(ref, key, path, blob, type) {
    var url = 'https://' + ref + '.supabase.co/storage/v1/object/' + BUCKET + '/' + path;
    // upsert — re-recording a cut must overwrite, not fail or silently keep the
    // old file. A stale video under a slug the queue already points at is worse
    // than an error, because nothing reports it.
    var r = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': type, 'x-upsert': 'true' },
      body: blob,
    });
    if (!r.ok) throw new Error('upload ' + path + ' → ' + r.status + ' ' + (await r.text()).slice(0, 160));
    return 'https://' + ref + '.supabase.co/storage/v1/object/public/' + BUCKET + '/' + path;
  }

  async function queue(ref, key, row) {
    // on_conflict=slug + merge-duplicates: re-publishing the same cut updates
    // the row in place rather than creating a second post of the same video.
    var r = await fetch('https://' + ref + '.supabase.co/rest/v1/social_queue?on_conflict=slug', {
      method: 'POST',
      headers: {
        apikey: key, authorization: 'Bearer ' + key,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([row]),
    });
    if (!r.ok) throw new Error('queue → ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return (await r.json())[0];
  }

  // Tomorrow at 23:00 UTC — the evening slot the PNG batches already use, so a
  // video never lands on top of a card.
  function nextSlot() {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(23, 0, 0, 0);
    return d.toISOString();
  }

  async function publish(o) {
    var vUrl = await put(o.ref, o.key, 'video/' + o.slug + '.mp4', o.video, 'video/mp4');
    var pUrl = o.poster ? await put(o.ref, o.key, 'video/' + o.slug + '.jpg', o.poster, 'image/jpeg') : null;
    var row = await queue(o.ref, o.key, {
      slug: o.slug, caption: o.caption,
      video_url: vUrl, thumb_url: pUrl,
      due_at: o.dueAt || nextSlot(), status: 'queued',
    });
    return { row: row, video: vUrl, poster: pUrl };
  }

  window.SOCIALUP = { publish: publish, nextSlot: nextSlot, pending: function () {
    try { return JSON.parse(sessionStorage.getItem('suPublish') || 'null'); } catch (e) { return null; }
  }, clearPending: function () { try { sessionStorage.removeItem('suPublish'); } catch (e) {} } };
})();

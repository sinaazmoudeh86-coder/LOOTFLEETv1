/* =============================================================================
   studio-page.js — the studio's page controller
   -----------------------------------------------------------------------------
   Binds the generic page to whichever video is selected. Nothing in here knows
   about any particular video: the picker, the shot list, the length, the poster
   timestamp and the caption are all read off the video's own definition, so a
   new cut appears here the moment it is registered in js/video-studio.js.
   ========================================================================== */
(function () {
  'use strict';
  var VS = window.VIDEOSTUDIO, SU = window.SOCIALUP;
  var cv = document.getElementById('mv');
  VS.attach(cv);

  var $ = function (id) { return document.getElementById(id); };
  var K_PICK = 'lfStudioPick', K_REF = 'lfSocialRef', K_KEY = 'lfSocialKey';
  var picked = null;

  function say(msg, col) { $('rectime').innerHTML = '<span class="dot" id="recdot"></span>' + msg; $('rectime').style.color = col || '#f2b24b'; }

  // ---- picker ---------------------------------------------------------------
  function renderPicks() {
    $('picks').innerHTML = '';
    VS.VIDEOS.forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'pick' + (v.slug === picked ? ' on' : '');
      b.innerHTML = '<b>' + v.name + '</b><span>' + v.note + '</span>';
      b.onclick = function () { try { localStorage.setItem(K_PICK, v.slug); } catch (e) {} location.reload(); };
      $('picks').appendChild(b);
    });
  }

  function load(slug, cb) {
    var entry = VS.VIDEOS.find(function (v) { return v.slug === slug; }) || VS.VIDEOS[0];
    picked = entry.slug;
    renderPicks();
    if (entry.def) return cb(entry.def);
    var s = document.createElement('script');
    s.src = entry.file + '?v=1';
    s.onload = function () { cb(entry.def); };
    s.onerror = function () { say('could not load ' + entry.file, '#ff4d5e'); };
    document.head.appendChild(s);
  }

  try { picked = localStorage.getItem(K_PICK); } catch (e) {}
  load(picked || VS.VIDEOS[0].slug, function (def) {
    if (!def) { say('video definition missing', '#ff4d5e'); return; }
    VS.run(def);
    var total = VS.total();
    $('len').textContent = total.toFixed(1) + 's';
    $('pat').textContent = def.posterAt.toFixed(1) + 's';
    // The shot list is the scene list — one source, so it can never describe a
    // cut that is not the cut. A hand-written list drifts the first time a beat
    // is retimed.
    var acc = 0;
    $('shots').innerHTML = def.scenes.map(function (s) {
      var at = acc.toFixed(1); acc += s.dur;
      return at.padStart(4, '0') + ' · ' + s.label;
    }).join('<br>');
    $('cap').textContent = def.caption;
    $('copycap').onclick = function () {
      navigator.clipboard.writeText(def.caption).then(function () {
        $('copycap').textContent = '✔ Copied';
        setTimeout(function () { $('copycap').textContent = 'Copy caption'; }, 1600);
      });
    };
    wireRecorder(def, total);
  });

  // ---- recorder -------------------------------------------------------------
  function wireRecorder(def, total) {
    var mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      .find(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); }) || '';
    $('fmt').textContent = mime ? (mime.indexOf('mp4') >= 0 ? '.mp4 (uploads directly)' : '.webm (convert first)') : 'MediaRecorder unsupported';
    try {
      $('su-ref').value = localStorage.getItem(K_REF) || '';
      $('su-key').value = localStorage.getItem(K_KEY) || '';
    } catch (e) {}

    function arm(publish) {
      if (publish) {
        var ref = $('su-ref').value.trim(), key = $('su-key').value.trim();
        if (!ref || !key) { say('project ref + service_role key required', '#ff4d5e'); return; }
        try { localStorage.setItem(K_REF, ref); localStorage.setItem(K_KEY, key); } catch (e) {}
        try { sessionStorage.setItem('suPublish', JSON.stringify({ ref: ref, key: key, slug: def.slug })); } catch (e) {}
      }
      sessionStorage.setItem('studioRec', def.slug);
      location.reload();   // capture must start at frame zero, not mid-loop
    }
    $('go').onclick = function () { arm(true); };
    $('dl').onclick = function () { arm(false); };

    if (sessionStorage.getItem('studioRec') !== def.slug || !mime) return;
    sessionStorage.removeItem('studioRec');
    var secs = Math.ceil(total * 10) / 10;
    say('arming…');
    setTimeout(function () {
      VS.restart();
      var stream = cv.captureStream(30);   // video only — no audio track, ever
      var chunks = [], rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 }); }
      catch (e) { say('recorder failed: ' + e.message, '#ff4d5e'); return; }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () { finish(chunks, mime, def, secs); };
      $('recdot').classList.add('on');
      var t0 = performance.now(), gotPoster = false;
      var tick = setInterval(function () {
        var el = (performance.now() - t0) / 1000;
        say(el.toFixed(1) + 's / ' + secs + 's');
        $('recdot').classList.add('on');
        // THE POSTER COMES OUT OF THE TAKE. Seeking to a timestamp afterwards
        // re-renders the scene and can land on a different frame than the encoder
        // saw; this is byte-for-byte a frame that is in the video.
        if (!gotPoster && el >= Math.min(def.posterAt, secs - 0.4)) { gotPoster = true; VS.grabPoster(); }
        if (el >= secs) { clearInterval(tick); rec.stop(); }
      }, 100);
      rec.start(250);
    }, 900);
  }

  function finish(chunks, mime, def, secs) {
    var ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    var blob = new Blob(chunks, { type: mime.split(';')[0] });
    $('recdot').classList.remove('on');
    var pend = SU && SU.pending();
    if (pend && ext === 'mp4') {
      SU.clearPending();
      say('uploading ' + (blob.size / 1048576).toFixed(1) + ' MB…');
      SU.publish({ ref: pend.ref, key: pend.key, slug: def.slug, video: blob, poster: VS.poster(), caption: def.caption })
        .then(function (r) { say('✔ queued for ' + new Date(r.row.due_at).toUTCString(), '#45e08c'); })
        .catch(function (e) { say('✗ ' + e.message, '#ff4d5e'); });
      return;
    }
    // No publish pending, or Chrome gave webm which Buffer will not accept —
    // fall back to downloading so a take is never lost.
    if (pend) SU.clearPending();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'lootfleet-' + def.slug + '.' + ext;
    document.body.appendChild(a); a.click(); a.remove();
    var pb = VS.poster();
    if (pb) { var pa = document.createElement('a'); pa.href = URL.createObjectURL(pb); pa.download = def.slug + '.jpg'; document.body.appendChild(pa); pa.click(); pa.remove(); }
    say(ext === 'mp4' ? '✔ saved ' + (blob.size / 1048576).toFixed(1) + ' MB + poster'
                      : '✔ saved .webm + poster — convert before uploading', ext === 'mp4' ? '#45e08c' : '#ff4d5e');
  }
})();

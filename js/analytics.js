/* =============================================================================
   analytics.js — Loot Fleet first-party page-view tracking
   ---------------------------------------------------------------------------
   Records one row per page view into the Supabase `page_views` table using the
   public anon key (insert-only by row-level security — visitors can never read
   traffic). Feeds the "Traffic" panel of the home-page admin dashboard.

   Drop this one line on any page you want counted, AFTER config.live.js:
       <script src="js/analytics.js?v=1"></script>

   No-ops silently if Supabase isn't configured or the page_views table hasn't
   been created yet (run supabase/admin.sql), so it can never break a page.
   ============================================================================= */
(function () {
  'use strict';
  var cfg = window.LOOTFLEET || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  function visitorId() {
    try {
      var k = 'lf_vid', v = localStorage.getItem(k);
      if (!v) {
        v = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return null; }
  }

  function uid() {
    try {
      var s = JSON.parse(localStorage.getItem('io-auth'));
      return (s && s.method === 'Supabase' && s.id) ? s.id : null;
    } catch (e) { return null; }
  }

  function track() {
    try {
      var body = JSON.stringify({
        path: location.pathname || '/',
        referrer: document.referrer || null,
        visitor_id: visitorId(),
        user_id: uid(),
      });
      fetch(cfg.supabaseUrl + '/rest/v1/page_views', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabaseAnonKey,
          'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
          'Prefer': 'return=minimal',
        },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  // fire once per page load
  if (document.readyState === 'complete' || document.readyState === 'interactive') track();
  else document.addEventListener('DOMContentLoaded', track);
})();

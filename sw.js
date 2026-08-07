/* =============================================================================
   sw.js — Loot Fleet service worker
   Makes the game installable and playable offline. Same-origin app shell is
   cached (stale-while-revalidate); navigations fall back to the cached entry
   when offline. Cross-origin requests (Supabase auth/data, the supabase CDN,
   Google Fonts) always go to the network and are never cached.
   Bump CACHE on every release to invalidate old assets.
   ============================================================================= */
const CACHE = 'lootfleet-v472';
const CORE = [
  './', 'index.html', 'game.html', 'brand.html', 'guides.html', 'manifest.json',
  'support.html', 'privacy.html', 'terms.html', 'features.html',
  'guides/guide.css', 'guides/how-to-play.html', 'guides/zones-and-citadels.html',
  'guides/galaxy-territory.html', 'guides/ships-and-fleet.html', 'guides/loot-rarity.html', 'guides/weapon-classes.html',
  'icon-192.png', 'icon-512.png',
  'css/style-v2.css', 'css/theme.css', 'css/web-v89.css', 'css/fx-cinematic.css', 'css/fx-primordial.css',
  'js/config-v2.js', 'js/items.js', 'js/entities.js', 'js/render.js',
  'js/galaxy.js', 'js/leaderboard.js', 'js/config.live.js',
  'js/cloud.js', 'js/account.js', 'js/territory.js', 'js/payments-v91.js', 'js/game-v93.js', 'js/ui-v94.js', 'js/fx-cinematic.js', 'js/fx-primordial.js', 'js/coach-v89.js', 'js/auth.js', 'js/prism-v5.js', 'js/prism-fleet.js', 'js/dreadnaught.js', 'js/galaxy-box.js',
  'js/showcase.js', 'js/ships-inline.js',
  'js/missions.js', 'js/moon-colony.js', 'js/moon-scene.js', 'js/fx-aaa.js',
  'js/shipworks.js', 'js/ascension.js', 'js/casino.js', 'js/casino2.js', 'js/social.js', 'js/alliance.js', 'js/alliance-boss.js', 'js/mail.js', 'js/redeem.js',
  'js/dreadnaught.js', 'js/server-dreadnaught.js',
  'ships/ship-monolith1.png', 'ships/ship-monolith2.png', 'ships/ship-monolith3.png', 'ships/ship-monolith4.png',
  'ships/void-cit-1.png', 'ships/void-cit-2.png', 'ships/void-cit-3.png', 'ships/void-cit-4.png', 'js/void-zone.js',
  'ships/ship-voidmaw.png', 'ships/ship-chromafang.png', 'ships/ship-chromaregent.png', 'ships/ship-frostyfrost.png', 'ships/ship-veridian.png', 'js/home-citadel.js', 'js/session-lock.js', 'js/vip.js', 'ships/hc-citadel.png', 'ships/hc-mine.png', 'ships/hc-silo.png', 'ships/hc-turret.png', 'ships/hc-repair.png',
  'css/fx-aaa.css', 'css/readability.css', 'css/moon-colony.css', 'css/pilot-ascension.css',
  // v407 — core screens that were fetched live only and so were unavailable offline
  'js/starforge.js', 'js/pilot-ascension.js', 'js/achievements.js', 'js/analytics.js', 'js/sim-pilots.js',
  'ships/ship-aeternum.png', 'ships/ship-aeternum-c.png',
  'ships/ship-frigate.png', 'ships/ship-interceptor.png', 'ships/ship-cruiser.png',
  'ships/ship-heavycruiser.png', 'ships/ship-destroyer.png', 'ships/ship-battleship.png',
  'ships/ship-dreadnought.png', 'ships/ship-carrier.png', 'ships/ship-aegis.png',
  'ships/ship-supercarrier.png', 'ships/ship-titan.png', 'ships/ship-mothership.png',
  'ships/ship-citadel.png',
  'ships/ship-oblivionspear.png', 'ships/ship-oblivionspearalpha.png', 'ships/ship-oblivionfinal.png',
  'ships/dread-1.png', 'ships/dread-2.png', 'ships/dread-3.png', 'ships/dread-4.png', 'ships/dread-5.png', 'ships/dread-6.png',
  'ships/ship-dread1.png', 'ships/ship-dread2.png', 'ships/ship-dread3.png', 'ships/ship-dread4.png', 'ships/ship-dread5.png', 'ships/ship-dread6.png',
  'ships/ship-titansina.png',
  // v215 / build 437 — THE KAEVITH INCURSION
  'css/kaevith.css', 'css/sheet-cta.css',
  'ships/ship-xen1.png', 'ships/ship-xen2.png', 'ships/ship-xen3.png', 'ships/ship-xen4.png', 'ships/ship-xen5.png',
  // changed this release and never precached, so offline served a stale copy
  'js/ranks-boards.js', 'js/ship-panels.js',
];

self.addEventListener('install', (e) => {
  // cache:'reload' forces every precache entry to come from the NETWORK —
  // never the HTTP cache — so a new release can't snapshot stale files.
  // allSettled (not addAll) so a single 404 can't abort the whole precache and
  // leave the new worker stuck 'waiting' — skipWaiting ALWAYS runs so updates
  // (new leaderboard, fixes, etc.) reach players on the next load.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // never touch cross-origin (Supabase API/CDN, fonts) — straight to network
  if (url.origin !== self.location.origin) return;

  // version.json is the update beacon — ALWAYS network, never cached
  if (/version\.json$/i.test(url.pathname)) { e.respondWith(fetch(req, { cache: 'no-store' })); return; }

  // navigations: network-first; offline -> the page actually requested, then
  // its sibling, then a last-resort shell (never silently swap game<->landing)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then((r) => r || caches.match('index.html'))
            .then((r) => r || caches.match('game.html'))
        )
    );
    return;
  }

  // App CODE (html/js/css): NETWORK-FIRST so the freshest build always wins
  // when online; fall back to cache only when offline. This is what keeps
  // iPad (long-lived PWA) from running a stale release. ?v= bumps now matter
  // because we honour the full URL on the network request.
  if (/\.(?:js|css|html)$/i.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Static assets (images, icons, fonts on-origin): stale-while-revalidate —
  // instant from cache, refreshed in the background. Safe because these are
  // content-stable / renamed when they change.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

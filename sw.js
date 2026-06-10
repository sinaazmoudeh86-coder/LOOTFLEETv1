/* =============================================================================
   sw.js — Loot Fleet service worker
   Makes the game installable and playable offline. Same-origin app shell is
   cached (stale-while-revalidate); navigations fall back to the cached entry
   when offline. Cross-origin requests (Supabase auth/data, the supabase CDN,
   Google Fonts) always go to the network and are never cached.
   Bump CACHE on every release to invalidate old assets.
   ============================================================================= */
const CACHE = 'lootfleet-v60';
const CORE = [
  './', 'index.html', 'game.html', 'manifest.json',
  'icon-192.png', 'icon-512.png',
  'css/style.css', 'css/theme.css', 'css/web.css',
  'js/config.js', 'js/items.js', 'js/entities.js', 'js/render.js',
  'js/galaxy.js', 'js/leaderboard.js', 'js/config.public.js',
  'js/cloud.js', 'js/account.js', 'js/territory.js', 'js/game.js', 'js/ui.js', 'js/auth.js',
  'js/showcase.js',
  'ships/ship-frigate.png', 'ships/ship-interceptor.png', 'ships/ship-cruiser.png',
  'ships/ship-heavycruiser.png', 'ships/ship-destroyer.png', 'ships/ship-battleship.png',
  'ships/ship-dreadnought.png', 'ships/ship-carrier.png', 'ships/ship-aegis.png',
  'ships/ship-supercarrier.png', 'ships/ship-titan.png', 'ships/ship-mothership.png',
  'ships/ship-citadel.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => {}));
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

  // navigations: network-first, fall back to cached entry when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('index.html').then((r) => r || caches.match('game.html')))
    );
    return;
  }

  // same-origin assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
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

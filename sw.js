/* =============================================================================
   sw.js — Loot Fleet service worker
   Makes the game installable and playable offline. Same-origin app shell is
   cached (stale-while-revalidate); navigations fall back to the cached entry
   when offline. Cross-origin requests (Supabase auth/data, the supabase CDN,
   Google Fonts) always go to the network and are never cached.
   Bump CACHE on every release to invalidate old assets.
   ============================================================================= */
const CACHE = 'lootfleet-v143';
const CORE = [
  './', 'index.html', 'game.html', 'brand.html', 'guides.html', 'manifest.json',
  'guides/guide.css', 'guides/how-to-play.html', 'guides/zones-and-citadels.html',
  'guides/galaxy-territory.html', 'guides/ships-and-fleet.html', 'guides/loot-rarity.html', 'guides/weapon-classes.html',
  'icon-192.png', 'icon-512.png',
  'css/style-v2.css', 'css/theme.css', 'css/web-v89.css', 'css/fx-cinematic.css', 'css/fx-primordial.css',
  'js/config-v2.js', 'js/items.js', 'js/entities.js', 'js/render.js',
  'js/galaxy.js', 'js/leaderboard.js', 'js/config.live.js',
  'js/cloud.js', 'js/account.js', 'js/territory.js', 'js/payments-v91.js', 'js/game-v93.js', 'js/ui-v94.js', 'js/fx-cinematic.js', 'js/fx-primordial.js', 'js/coach-v89.js', 'js/auth.js', 'js/prism-v5.js', 'js/prism-fleet.js',
  'js/showcase.js', 'js/ships-inline.js',
  'fleet-rank-embed.html',
  'ships/ship-frigate.png', 'ships/ship-interceptor.png', 'ships/ship-cruiser.png',
  'ships/ship-heavycruiser.png', 'ships/ship-destroyer.png', 'ships/ship-battleship.png',
  'ships/ship-dreadnought.png', 'ships/ship-carrier.png', 'ships/ship-aegis.png',
  'ships/ship-supercarrier.png', 'ships/ship-titan.png', 'ships/ship-mothership.png',
  'ships/ship-citadel.png',
  'ships/ship-oblivionspear.png', 'ships/ship-oblivionspearalpha.png', 'ships/ship-oblivionfinal.png',
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

  // navigations: network-first, fall back to cached entry when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('index.html').then((r) => r || caches.match('game.html')))
    );
    return;
  }

  // same-origin assets: stale-while-revalidate (ignore ?v= cache-bust queries
  // so the precached app shell serves versioned requests instantly)
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

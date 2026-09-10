// Offline support.
//
// Strategy is stale-while-revalidate: every request is answered from the cache
// immediately (so the app opens instantly, and works in airplane mode), while a
// fresh copy is fetched in the background for next time. That means an edit to
// config.js or app.js reaches both phones on their second load, without ever
// leaving them stranded when there is no signal.

const CACHE = 'shopping-list-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './store.js',
  './sync.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Tolerate a single missing file rather than failing the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase traffic — it must fail fast when offline so the app
  // can fall back to local state instead of replaying a stale response.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });

      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) return cached;

      const fresh = await network;
      if (fresh) return fresh;

      // Offline, uncached, and it's a page load: hand back the app shell.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    })
  );
});

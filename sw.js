// Offline support: cache the app shell. Bump VERSION whenever you change any app file.
const VERSION = 'ironlog-v9';
const FILES = [
  './', './index.html', './styles.css', './app.js', './exercises.js', './exercise-info.js', './manifest.json',
  './icons/logo.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== MEDIA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Exercise photos/instructions: cache-first, kept across app updates, so they work offline once seen.
const MEDIA = 'ironlog-media';
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith('https://cdn.jsdelivr.net/gh/everkinetic/data')) return;
  e.respondWith(
    caches.open(MEDIA).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    })
  );
});

// App files: stale-while-revalidate. Open instantly from cache (even with bad gym signal),
// refresh the cache in the background so updates appear on the next launch.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      return cached || (await network) || cache.match('./index.html');
    })
  );
});

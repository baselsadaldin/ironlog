// Offline support. Bump VERSION whenever you change any app file.
const VERSION = 'ironlog-v12';
const MEDIA = 'ironlog-media';
const FILES = [
  './', './index.html', './styles.css', './app.js', './exercises.js', './exercise-info.js', './manifest.json',
  './icons/logo.svg', './icons/app-icon-180.png', './icons/app-icon-192.png', './icons/app-icon-512.png'
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

// Exercise drawings: cache-first, kept across app updates, so they work offline once seen.
function mediaResponse(req) {
  return caches.open(MEDIA).then(async cache => {
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  });
}

// App files: network first (so you always get the latest version when online),
// falling back to the saved copy when offline or the connection is too slow (3s).
function appResponse(req) {
  return caches.open(VERSION).then(async cache => {
    const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    const timeout = new Promise(resolve => setTimeout(resolve, 3000, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (_) { /* offline */ }
    const cached = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    return cached || network;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith('https://cdn.jsdelivr.net/gh/everkinetic/data')) e.respondWith(mediaResponse(req));
  else if (req.url.startsWith(self.location.origin)) e.respondWith(appResponse(req));
});

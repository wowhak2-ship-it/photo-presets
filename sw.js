// Service worker — offline cache for the Photo Presets PWA
const CACHE = 'photo-presets-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './demo.jpg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const req = e.request;
  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

  if (isHTML) {
    // Network-first: always get fresh HTML/JS, fall back to cache when offline
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  } else {
    // Cache-first for static assets (icons, manifest)
    e.respondWith(
      caches.match(req).then(cached =>
        cached || fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return resp;
        })
      )
    );
  }
});

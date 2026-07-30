/* FitTrack — service worker.
 *
 * Makes the installed app work with no connection at all. Every asset is
 * hashed into a versioned cache; `__BUILD_ID__` is substituted at build time,
 * so shipping a new build invalidates the old cache rather than leaving a
 * phone stuck on a months-old shell.
 *
 * Strategy is network-first for the HTML shell (so an update is picked up as
 * soon as you are online) and cache-first for immutable vendor scripts.
 */

const BUILD = '__BUILD_ID__';
const CACHE = 'fittrack-' + BUILD;

const PRECACHE = [
  './',
  './index.html',
  './config.js',
  './sync.js',
  './lib/react.min.js',
  './lib/react-dom.min.js',
  './lib/supabase.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one 404 cannot fail the whole install.
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('fittrack-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase traffic — auth and sync must always hit the network,
  // and a cached 401 would be a nightmare to debug.
  if (url.origin !== self.location.origin) return;

  const isShell = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});

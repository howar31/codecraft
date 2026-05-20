// Codec Craft service worker.
// - App shell (same-origin): stale-while-revalidate; populated opportunistically on first visit.
// - ffmpeg-core from unpkg (version-pinned): cache-first, indefinite. URL change = new cache.
// Bump VERSION to invalidate every cache (e.g. when app shell semantics change).

const VERSION = 'codecraft-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const CORE_CACHE = `${VERSION}-core`;

const BOOTSTRAP_ASSETS = [
  './',
  './manifest.webmanifest',
  './favicon.svg',
];

const CORE_ORIGIN = 'https://unpkg.com';
const CORE_PATH_MARKER = '/@ffmpeg/core@';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(BOOTSTRAP_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === CORE_ORIGIN && url.pathname.includes(CORE_PATH_MARKER)) {
    event.respondWith(cacheFirst(req, CORE_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || fetchPromise;
}

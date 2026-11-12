/**
 * Shule Yetu service worker — storage-segregated, update-aware app shell.
 *
 * Build infrastructure (kept from the platform branch): the post-build step
 * replaces the two build tokens below, so every deployment has
 * a fresh cache name and the exact hashed bundles needed for a cold boot.
 *
 * Storage segregation:
 *   shule-shell-*  HTML entry points and the precached app shell only.
 *   shule-assets-* runtime JS/CSS/fonts/images.
 *
 * /api, /webhooks, /health and /metrics are NEVER written to CacheStorage.
 * Authenticated responses contain tenant and learner data and stay on the
 * server; offline API reads fail closed with 503. Queued writes remain in the
 * IndexedDB outbox owned by src/lib/sync.ts.
 *
 * Updates are explicit: install does not skipWaiting. The page offers a
 * controlled reload, so a deployment cannot swap chunks under an open form.
 */

const BUILD_REVISION = '__BUILD_REVISION__';
const PRECACHE_ASSETS = __PRECACHE_ASSETS__;

const SHELL_CACHE = `shule-shell-${BUILD_REVISION}`;
const ASSET_CACHE = `shule-assets-${BUILD_REVISION}`;
const CACHE_PREFIXES = ['shule-shell-', 'shule-assets-', 'shuleyetu-'];

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

const PRECACHE = [...STATIC_ASSETS, ...PRECACHE_ASSETS];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // One optional asset must not fail the whole install.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] precache skipped:', url, err);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
              key !== SHELL_CACHE &&
              key !== ASSET_CACHE
          )
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isPrivateApi(pathname) {
  return (
    pathname.startsWith('/api') ||
    pathname.startsWith('/webhooks') ||
    pathname.startsWith('/health') ||
    pathname.startsWith('/metrics')
  );
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/')) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPrivateApi(url.pathname)) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              code: 'OFFLINE',
              message: 'This information needs a connection. Changes queued on this device are safe.',
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            }
          )
      )
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }
});

// Background Sync asks a live page to drain its IndexedDB outbox. The worker
// never posts mutations itself, so auth and CSRF stay in the page context.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-outbox') {
    event.waitUntil(drainOutboxViaClients());
  }
});

async function drainOutboxViaClients() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'TRIGGER_OUTBOX_DRAIN' });
  }
}

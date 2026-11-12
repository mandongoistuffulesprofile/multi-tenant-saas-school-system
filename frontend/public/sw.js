/**
 * Kenyan School SaaS Service Worker (Offline-First Resilient PWA)
 * Protects against Safaricom / Airtel staffroom internet blackouts.
 *
 * Strategy:
 *  - Install: precache the full app shell (JS, CSS, HTML, i18n, icons).
 *  - Fetch:  stale-while-revalidate for static + images, network-first for
 *    /api (with cached fallback), pass-through for POSTs (mutations are owned
 *    by the IndexedDB outbox, never faked by the SW).
 *  - Background Sync: when the browser fires a 'sync-outbox' tag, ask the
 *    open page to drain its IndexedDB queue to /sync/push so queued marks
 *    survive a killed tab.
 */

// The suffix is filled in by scripts/inject-precache.mjs with a hash of the
// emitted bundles, so every release gets a fresh cache and activate() deletes
// the previous one.
const CACHE_NAME = 'shuleyetu-__BUILD_REVISION__';

// App shell entries precached at install. The build step (vite) emits these
// files into dist/; the SW only needs the routes, not the hashed filenames.
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

// The hashed Vite bundles, injected at build time by
// scripts/inject-precache.mjs. Without these the cached index.html points at
// assets that are not available offline.
const PRECACHE_ASSETS = __PRECACHE_ASSETS__;

const PRECACHE = [...STATIC_ASSETS, ...PRECACHE_ASSETS];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // A single missing file must not fail the whole install: without an
      // installed worker the app is neither installable nor offline-capable.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] precache skipped:', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation/API; stale-while-revalidate for static assets.
// Never cache authenticated API responses to avoid stale/tenant data leaks.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Mutations are never cached — the outbox owns the write path.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isApi =
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/webhooks') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/metrics');

  if (isApi) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Hashed bundles are immutable: once precached, never touch the network.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  // Navigation: serve the SPA shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static + images: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return resp;
      });
      return cached || fetchPromise;
    })
  );
});

// Background Sync: when the browser fires a 'sync-outbox' tag, ask the open
// page to drain its IndexedDB queue to /sync/push so queued marks survive a
// killed tab. Chrome/Android supports this; Safari is the laggard.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-outbox') {
    event.waitUntil(drainOutboxViaClients());
  }
});

async function drainOutboxViaClients() {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    if (clients.length === 0) return;
    // The open page owns the Dexie connection; ask it to drain its queue.
    for (const client of clients) {
      client.postMessage({ type: 'TRIGGER_OUTBOX_DRAIN' });
    }
  } catch (err) {
    console.warn('[SW] background sync failed, will retry:', err);
  }
}
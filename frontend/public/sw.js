/**
 * Kenyan School SaaS Service Worker (Offline-First Resilient PWA)
 * Protects against Safaricom / Airtel staffroom internet blackouts.
 */

const CACHE_NAME = 'shuleyetu-v1.0.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/thermalReceipt.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network-first for navigation/API; cache-first for static assets only.
// Never cache authenticated API responses to avoid stale/tenant data leaks.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isApi = url.pathname.startsWith('/api') || url.pathname.startsWith('/webhooks') || url.pathname.startsWith('/health') || url.pathname.startsWith('/metrics');
  if (isApi) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Background Sync Event Handler
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-cbc-assessments') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_OUTBOX_DRAIN' });
        });
      })
    );
  }
});

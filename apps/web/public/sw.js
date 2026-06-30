const HIPIPLAY_CACHE = 'hipiplay-pwa-safe-cache-v20260619';

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(HIPIPLAY_CACHE).then(async (cache) => {
      const urls = [
        '/pwa/',
        '/pwa/manifest-hipiplay.webmanifest'
      ];

      await Promise.allSettled(
        urls.map((url) => cache.add(url))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== HIPIPLAY_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/pwa/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();

          caches.open(HIPIPLAY_CACHE).then((cache) => {
            cache.put(request, copy).catch(() => {});
          });
        }

        return response;
      });
    })
  );
});
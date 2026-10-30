/* ==========================================================================
   PinGrab service worker
   --------------------------------------------------------------------------
   Strategy:
     - App shell (HTML/CSS/JS/icons): cached on install, so the UI opens
       instantly and still works offline.
     - Page navigations: network-first, so content is never stale; the cached
       copy is the offline fallback.
     - Other same-origin assets: stale-while-revalidate.
     - /api/ requests and downloads are NEVER cached (they are live data).
   Bump CACHE_VERSION whenever you change any static file.
   ========================================================================== */

var CACHE_VERSION = 'pingrab-v2';
var SHELL_CACHE = CACHE_VERSION + '-shell';
var RUNTIME_CACHE = CACHE_VERSION + '-runtime';

var SHELL_ASSETS = [
  './',
  './index.html',
  './help.html',
  './privacy.html',
  './terms.html',
  './404.html',
  './css/style.css',
  './js/config.js',
  './js/downloader.js',
  './js/app.js',
  './js/pages.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      /* addAll rejects if a single file is missing, so add one by one and
         tolerate 404s (e.g. during local development). */
      return Promise.all(SHELL_ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(CACHE_VERSION) !== 0) return caches.delete(key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApiRequest(url) {
  return url.pathname.indexOf('/api/') === 0 ||
         url.pathname.indexOf('/api') === 0 && url.pathname.length === 4;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  /* Live data: resolve/download endpoints must always hit the network. */
  if (isApiRequest(url)) return;

  /* Never cache ads or analytics. */
  if (/googlesyndication|doubleclick|googletagmanager|google-analytics|adtrafficquality/.test(url.hostname)) return;

  var sameOrigin = url.origin === self.location.origin;

  /* Page navigations: network-first with cached fallback. */
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').indexOf('text/html') >= 0) {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(SHELL_CACHE).then(function (cache) { cache.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* Same-origin static assets: stale-while-revalidate. */
  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var copy = response.clone();
            caches.open(SHELL_CACHE).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        }).catch(function (err) {
          if (cached) return cached;
          throw err;
        });
        return cached || network;
      })
    );
  }
});

/* Let the page ask a waiting worker to take over immediately. */
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

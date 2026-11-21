// Aexyron Notes offline worker.
// * Online: the app code comes fresh from the network every time it opens, so the
//   newest version is what you see (the browser's own cache makes this quick).
// * Offline, or on a very slow connection: the saved copy opens instead.
// Big engine files and assets answer from the cache instantly and refresh quietly.
const VERSION = '20261121-115818';
const CACHE = 'aexyron-' + VERSION;
const CORE = [
  './', 'index.html', 'main.dart.js', 'flutter.js', 'flutter_bootstrap.js', 'manifest.json',
  'aexyron_scan.js', 'favicon.png', 'icons/Icon-192.png', 'icons/Icon-512.png',
  'assets/FontManifest.json', 'assets/AssetManifest.bin.json', 'assets/fonts/MaterialIcons-Regular.otf',
];
// The app's own code: always try the network first.
const FRESH = /(\/|index\.html|main\.dart\.js|flutter_bootstrap\.js|flutter\.js|manifest\.json|aexyron_scan\.js|version\.json)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aexyron-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(req, key) {
  return caches.open(CACHE).then((cache) => {
    const net = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(key || req, res.clone());
      return res;
    });
    // If the network is slow (over 4 s) or down, open the saved copy.
    const slow = new Promise((resolve) => setTimeout(resolve, 4000)).then(() => cache.match(key || req));
    return Promise.race([net.catch(() => cache.match(key || req)), slow.then((hit) => hit || net)]).then(
      (res) => res || net,
    );
  });
}

function cacheFirst(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // OCR engine and language data from the CDN: keep a copy so scanning works offline too.
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com';
  if (!sameOrigin && !cdn) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 'index.html'));
  } else if (sameOrigin && FRESH.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

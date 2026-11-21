// Aexyron Notes offline worker: opens instantly, works offline, stays up to date.
// * The page (index.html) is checked online first, but never waits more than
//   1.5 s: after that the saved copy opens at once.
// * App code and the drawing engine have a new address for every release, so
//   they are served straight from the device; a new release is fetched once.
// * Fonts, icons and other files open from the device and refresh quietly.
const VERSION = '20261121-232309';
const CANVASKIT = 'canvaskit-20261121-232309/';
const CACHE = 'aexyron-app';
const CORE = ['index.html', 'manifest.json', 'favicon.png', 'icons/Icon-192.png', 'icons/Icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        Promise.all(
          CORE.map((u) =>
            fetch(u, { cache: 'reload' }).then((r) => r.ok && cache.put(u, r)).catch(() => null),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches from older designs, and files from older releases.
      for (const k of await caches.keys()) if (k.startsWith('aexyron-') && k !== CACHE) await caches.delete(k);
      if (!VERSION.startsWith('__')) {
        const cache = await caches.open(CACHE);
        for (const req of await cache.keys()) {
          const u = new URL(req.url);
          const stampedNow = u.searchParams.get('v') === VERSION || (!CANVASKIT.startsWith('__') && u.pathname.includes('/' + CANVASKIT));
          const core = CORE.some((c) => u.pathname.endsWith('/' + c));
          // A new release: everything else (assets, fonts, old code) is fetched fresh once.
          if (!stampedNow && !core) await cache.delete(req);
        }
      }
      await self.clients.claim();
    })(),
  );
});

// Some servers send the drawing engine (.wasm) with a generic type, which
// browsers refuse to run quickly; give it the right one.
async function fixType(req, res) {
  if (!res || !res.ok || !new URL(req.url).pathname.endsWith('.wasm')) return res;
  if ((res.headers.get('content-type') || '').includes('application/wasm')) return res;
  const headers = new Headers(res.headers);
  headers.set('content-type', 'application/wasm');
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

function pageFirst(req) {
  return caches.open(CACHE).then((cache) => {
    const net = fetch(req).then((res) => {
      if (res && res.ok) cache.put('index.html', res.clone());
      return res;
    });
    const quick = new Promise((resolve) => setTimeout(resolve, 1500)).then(() => cache.match('index.html'));
    return Promise.race([net.catch(() => cache.match('index.html')), quick.then((hit) => hit || net)]).then((r) => r || net);
  });
}

async function deviceFirst(req, refresh) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fetchAndKeep = () =>
    fetch(req)
      .then((res) => fixType(req, res))
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
  if (hit) {
    // Release-stamped files never change; others refresh quietly for next time.
    if (refresh) fetchAndKeep().catch(() => null);
    return fixType(req, hit);
  }
  return fetchAndKeep();
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
    event.respondWith(pageFirst(req));
    return;
  }
  // Release-stamped code and engine never change at their address: no refresh needed.
  const stamped = url.searchParams.has('v') || /\/canvaskit-[^/]+\//.test(url.pathname);
  event.respondWith(deviceFirst(req, !stamped));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

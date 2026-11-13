// Bump the version on every release; keep SHELL in step with app/ modules.
const CACHE = 'capture-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'src/app.js',
  'src/store/store.js', 'src/store/idb.js',
  'src/core/csv.js', 'src/core/guard.js', 'src/core/ids.js',
  'src/core/quickadd.js', 'src/core/summary.js', 'src/core/time.js', 'src/core/banners.js',
  'src/ui/dom.js', 'src/ui/today.js', 'src/ui/edit.js', 'src/ui/week.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('capture-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

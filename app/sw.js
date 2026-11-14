// Bump the version on every release; keep SHELL in step with app/ modules.
const CACHE = 'capture-v7';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'src/app.js', 'src/theme-boot.js',
  'src/store/store.js', 'src/store/idb.js',
  'src/core/csv.js', 'src/core/guard.js', 'src/core/ids.js',
  'src/core/quickadd.js', 'src/core/summary.js', 'src/core/time.js', 'src/core/banners.js', 'src/core/patch.js',
  'src/ui/dom.js', 'src/ui/theme.js', 'src/ui/today.js', 'src/ui/edit.js', 'src/ui/week.js',
  'src/send.js', 'src/core/backup.js', 'src/ui/settings.js', 'src/ui/help.js',
  'icons/mark.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/space-grotesk-latin-600-normal.woff2', 'fonts/inter-latin-400-normal.woff2',
  'fonts/inter-latin-600-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2',
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

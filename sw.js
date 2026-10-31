/* Offline shell. Bump VERSION whenever you deploy changes to these files. */
const VERSION = 'countdown-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'presets.js', 'app.js', 'sync.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll([...SHELL, CDN])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // the pinned library never changes: cache first
  if (url.href === CDN) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  // own files: network first so deploys show up, cache when offline.
  // Everything else (Supabase API, auth) goes straight to the network.
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))),
  );
});

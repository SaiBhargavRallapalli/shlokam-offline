/* Offline-first service worker: cache app shell + API JSON for offline use */
const CACHE = 'shlokam-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API: network-first, cache fallback (only successful responses are cached)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      }
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // shell + export html: cache-first, network fallback
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
    }
    return r;
  }).catch(() => caches.match('/index.html'))));
});

/* Offline-first service worker: cache app shell + API JSON for offline use */
const CACHE = 'shlokam-v3';
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
  // Large binaries (audio, PDFs) are never put in the SW cache — they stream
  // from network (or the server disk cache) to avoid filling storage.
  if (url.pathname.startsWith('/api/audio') || url.pathname.startsWith('/api/pdf')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
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

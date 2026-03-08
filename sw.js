const CACHE = "untis-v2"; // bump version to clear old cache

self.addEventListener("install", e => {
  self.skipWaiting(); // activate immediately
});

self.addEventListener("activate", e => {
  // delete old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request)) // fallback to cache if offline
  );
});

self.addEventListener('notificationclick', e => {
    e.notification.close()
    e.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            // if app is already open, focus it
            const existing = list.find(c => c.url === '/' && 'focus' in c)
            if (existing) return existing.focus()
            // otherwise open a new window
            return clients.openWindow(e.notification.data?.url ?? '/')
        })
    )
})
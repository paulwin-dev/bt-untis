const CACHE = "untis-v3";

self.addEventListener("install", e => {
    self.skipWaiting();
});

self.addEventListener("activate", e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
});

self.addEventListener("fetch", e => {
    // skip non-GET and external requests
    if (e.request.method !== 'GET') return;
    if (!e.request.url.startsWith(self.location.origin)) return;

    e.respondWith(
        caches.open(CACHE).then(async cache => {
            try {
                const response = await fetch(e.request);
                cache.put(e.request, response.clone());
                return response;
            } catch {
                const cached = await cache.match(e.request);
                if (cached) return cached;
                return new Response('Offline', { status: 503 });
            }
        })
    );
});

self.addEventListener('notificationclick', e => {
    e.notification.close()
    e.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            const existing = list.find(c => c.url === '/' && 'focus' in c)
            if (existing) return existing.focus()
            return clients.openWindow(e.notification.data?.url ?? '/')
        })
    )
});
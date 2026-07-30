const CACHE = 'ispdesk-v1';

// ── Instalação: pré-cacheia o shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(['/', '/logoisp.png']))
  );
});

// ── Ativação: remove caches antigas ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: estratégia por tipo de request ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Nunca intercepta chamadas à API — sempre vai para a rede
  if (url.pathname.startsWith('/api')) return;

  // Navegação (HTML): network-first → fallback para cache (app offline)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Assets estáticos: cache-first → atualiza em background
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      });
      return cached || network;
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'ISPDesk', {
      body: data.body || 'Nova mensagem',
      icon: '/logoisp.png',
      badge: '/logoisp.png',
      tag: data.tag || 'ispdesk',
      renotify: true,
      data: { url: '/inbox' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('/inbox'));
      if (existing) return existing.focus();
      return clients.openWindow('/inbox');
    })
  );
});

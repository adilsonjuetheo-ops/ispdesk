const CACHE = 'ispdesk-v3';

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

  // Nunca intercepta chamadas à API nem o version.json — sempre vai para a rede
  // (version.json precisa ser sempre fresco pra detectar atualizações do app)
  if (url.pathname.startsWith('/api') || url.pathname === '/version.json') return;

  // Navegação (HTML): network-first → fallback para cache (app offline)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Clona ANTES de devolver: dentro do then de caches.open o corpo
          // já teria sido consumido por quem recebeu a resposta.
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(request, copia)).catch(() => {});
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
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(request, copia)).catch(() => {});
        }
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

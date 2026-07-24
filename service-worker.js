const CACHE_NAME = 'coconut-chat-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/beach-bg.png',
  '/coconut-logo-clean.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        )
      ),
      clients.claim()
    ])
  );
});

self.addEventListener('push', (event) => {
  const payload = event.data?.json
    ? event.data.json()
    : event.data?.text
      ? JSON.parse(event.data.text())
      : {};

  const title = payload.title || 'Coconut Chat';
  const body = payload.body || '새 메시지가 도착했습니다.';
  const unreadCount = Number(payload.unreadCount || payload.count || 0);

  if ('setAppBadge' in self.registration) {
    event.waitUntil(self.registration.setAppBadge(unreadCount));
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      tag: 'coconut-chat',
      renotify: true,
      data: {
        url: payload.url || '/'
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then(() => client.navigate(targetUrl));
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_BADGE') {
    if ('clearAppBadge' in self.registration) {
      event.waitUntil(self.registration.clearAppBadge());
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') {
    return;
  }

  // 로그인, 친구, 채팅 API와 Socket.IO는 실시간 서버 요청이어야 해서 캐시하지 않는다.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
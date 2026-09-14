// Service worker — kizárólag Web Push értesítésekhez (nincs cache-elés,
// az app maga offline-képes a helyi tükörrel). Az Expo a public/ mappát
// a dist/ gyökerébe másolja, így /sw.js-ként érhető el, scope: "/".

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Költségkövető';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // ha már nyitva az app, arra váltunk és odanavigálunk
      for (const client of list) {
        if ('focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : c));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

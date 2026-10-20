// Service Worker: офлайн-кэш приложения «Хранилище»
const VERSION = '1.5.2';
const CACHE = 'info-storage-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/db.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' — скачиваем файлы в обход HTTP-кэша,
      // иначе после обновления сайта в кэш могли попасть старые версии.
      Promise.all(
        ASSETS.map((url) =>
          fetch(new Request(url, { cache: 'reload' })).then((res) => cache.put(url, res))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

// ===== Напоминания по времени =====

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('info-storage');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function notifyDueTasks() {
  try {
    const db = await openDb();
    if (!db.objectStoreNames.contains('tasks')) return;
    const tasks = await new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readonly');
      const req = tx.objectStore('tasks').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    const due = tasks.filter((t) => t.remindAt && !t.done && !t.remindFired && t.remindAt <= now);
    for (const t of due) {
      await self.registration.showNotification('Напоминание', {
        body: t.text,
        tag: 'task-' + t.id,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data: { url: './#/tasks' },
      });
      t.remindFired = true;
      await new Promise((resolve) => {
        const tx = db.transaction('tasks', 'readwrite');
        tx.objectStore('tasks').put(t);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch (e) {
    // нет разрешения на уведомления или база недоступна — просто пропускаем
  }
}

// Периодическая фоновая проверка (Chrome/Android, установленное приложение)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-reminders') {
    event.waitUntil(notifyDueTasks());
  }
});

// Нажатие на уведомление — открыть вкладку «Задачи»
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './#/tasks';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      if ('navigate' in client) {
        try { await client.navigate(target); } catch (e) {}
      }
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});

// ===== Слой данных: IndexedDB =====

const DB_NAME = 'info-storage';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'id' });
          store.createIndex('folderId', 'folderId', { unique: false });
        }
        if (!db.objectStoreNames.contains('lists')) {
          db.createObjectStore('lists', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStore(name, mode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

// Генератор ID (randomUUID работает на HTTPS/localhost, иначе запасной вариант)
export const uid = () =>
  (crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

export async function getAll(name) {
  return wrap((await getStore(name, 'readonly')).getAll());
}

export async function get(name, id) {
  return wrap((await getStore(name, 'readonly')).get(id));
}

export async function put(name, obj) {
  return wrap((await getStore(name, 'readwrite')).put(obj));
}

export async function del(name, id) {
  return wrap((await getStore(name, 'readwrite')).delete(id));
}

export async function recordsByFolder(folderId) {
  const store = await getStore('records', 'readonly');
  return wrap(store.index('folderId').getAll(folderId));
}

export async function deleteRecordsByFolder(folderId) {
  const records = await recordsByFolder(folderId);
  const store = await getStore('records', 'readwrite');
  await Promise.all(records.map((r) => wrap(store.delete(r.id))));
}

// ===== Экспорт / импорт =====

export async function exportAll() {
  return {
    app: 'info-storage',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: await getAll('folders'),
    records: await getAll('records'),
    lists: await getAll('lists'),
  };
}

export async function importAll(data) {
  for (const name of ['folders', 'records', 'lists']) {
    await wrap((await getStore(name, 'readwrite')).clear());
  }
  for (const folder of data.folders) await put('folders', folder);
  for (const record of data.records) await put('records', record);
  for (const list of data.lists) await put('lists', list);
}

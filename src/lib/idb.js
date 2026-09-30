// Minimal IndexedDB key-value store for the content cache and the offline
// progress snapshot. Every call fails soft: no IndexedDB means no cache.
const DB = "word-hunter", STORE = "kv";
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const idb = {
  get: (key) => run("readonly", (s) => s.get(key)).catch(() => undefined),
  set: (key, value) => run("readwrite", (s) => s.put(value, key)).catch(() => undefined),
  del: (key) => run("readwrite", (s) => s.delete(key)).catch(() => undefined),
};

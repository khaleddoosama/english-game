// Minimal IndexedDB key-value store for the content cache and the offline
// progress snapshot. Calls never throw: no IndexedDB means no cache.
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

// get: undefined when missing or unreadable. set/del: true when written,
// false when the browser refused (storage full, private mode, blocked), so
// callers can tell the player their progress isn't kept on this device.
export const idb = {
  get: (key) => run("readonly", (s) => s.get(key)).catch(() => undefined),
  set: (key, value) => run("readwrite", (s) => s.put(value, key)).then(() => true, (e) => { console.warn("IndexedDB write failed:", e?.message || e); return false; }),
  del: (key) => run("readwrite", (s) => s.delete(key)).then(() => true, () => false),
};

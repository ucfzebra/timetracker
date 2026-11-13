// IndexedDB backend. Same async contract as memory.js.
const STORES = { entries: 'entry_id', nicknames: 'name', settings: 'key' };

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function openIdbBackend(name = 'capture', version = 1) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const [t, keyPath] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(t)) continue;
        const s = db.createObjectStore(t, { keyPath });
        if (t === 'entries') s.createIndex('date', 'date');
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const store = (t, mode) => {
        if (!STORES[t]) throw new Error(`unknown table: ${t}`);
        return db.transaction(t, mode).objectStore(t);
      };
      resolve({
        get: (t, key) => wrap(store(t, 'readonly').get(key)),
        // Resolves only once the transaction has committed; rejects on abort or error.
        put: (t, obj) => new Promise((resolve, reject) => {
          if (!STORES[t]) throw new Error(`unknown table: ${t}`);
          const tx = db.transaction(t, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
          tx.onerror = () => reject(tx.error);
          tx.objectStore(t).put(obj);
        }),
        all: (t) => wrap(store(t, 'readonly').getAll()),
      });
    };
  });
}

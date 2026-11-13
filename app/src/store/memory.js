// In-memory backend. Same contract as the IndexedDB backend (Task 7).
const KEYS = { entries: 'entry_id', nicknames: 'name', settings: 'key' };

export function createMemoryBackend() {
  const tables = {};
  for (const t of Object.keys(KEYS)) tables[t] = new Map();
  const table = (t) => {
    if (!tables[t]) throw new Error(`unknown table: ${t}`);
    return tables[t];
  };
  return {
    async get(t, key) {
      const v = table(t).get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
    async put(t, obj) {
      table(t).set(obj[KEYS[t]], structuredClone(obj));
    },
    async all(t) {
      return [...table(t).values()].map((v) => structuredClone(v));
    },
  };
}

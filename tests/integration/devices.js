// A stand-in for the browser's IndexedDB with one store per "device", so two
// devices of the same player keep separate local snapshots and caches. Switch
// with useDevice("phone") before calling a repo.
const stores = new Map();
let current = "default";
const store = () => { if (!stores.has(current)) stores.set(current, new Map()); return stores.get(current); };

export const useDevice = (name) => { current = name; };
export const resetDevices = () => { stores.clear(); current = "default"; };
export const deviceStore = (name) => stores.get(name);
export const idbMock = {
  idb: {
    get: async (k) => { const v = store().get(k); return v === undefined ? undefined : structuredClone(v); },
    set: async (k, v) => { store().set(k, structuredClone(v)); return true; },
    del: async (k) => { store().delete(k); return true; },
  },
};

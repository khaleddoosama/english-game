// Claude owns persistence. Never switch the player's data to browser storage.
export const storage = {
  get: async (key) => {
    if (!window.storage?.get) throw new Error("Claude artifact storage is unavailable");
    return window.storage.get(key, false);
  },
  set: async (key, value) => {
    if (!window.storage?.set) throw new Error("Claude artifact storage is unavailable");
    return window.storage.set(key, value, false);
  },
  delete: async (key) => {
    if (!window.storage?.delete) throw new Error("Claude artifact storage is unavailable");
    return window.storage.delete(key, false);
  },
};

// The artifact storage backend rejects a write with a 409 whenever it lands
// while another write to the same key is still in flight (e.g. from a
// double-mounted effect, or two tabs on the same published link). That's a
// transient collision, not a real failure — the losing write is perfectly
// valid, it just needs to land a beat later. Retry with jittered backoff a
// couple of times before treating it as a genuine save failure.
export async function storageSetWithRetry(key, value, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await storage.set(key, value);
    } catch (e) {
      if (attempt === attempts) throw e;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt + Math.random() * 250));
    }
  }
}

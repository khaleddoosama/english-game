// What Home needs to know about a player's library: pure rules over what the
// library API answers. (The Home screens themselves live in features/home.)

// The words and rules a player has, as the game's keys. Ids that map to no key
// (a word taken out of the course since) are left out.
export function keysFromList(list, ids) {
  return {
    words: new Set(list.words.map((w) => ids.keyOfSense(w.id)).filter(Boolean)),
    rules: new Set(list.rules.map((r) => ids.keyOfRule(r.id)).filter(Boolean)),
  };
}

// The player's biggest views (no parent) in their order: each is a tab on Home.
export function rootsFromTree(rows) {
  return rows.filter((v) => !v.parent).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((v) => ({ id: v.id, name: v.name }));
}

// A player (not the admin) sees only what is in their own library; the admin
// sees the whole course. While the keys are still being read, Home waits
// instead of showing the whole course for a moment.
export function homeLimits({ status, isAdmin, keys }) {
  const ready = status === "ready" && !isAdmin;
  return { limit: ready && !!keys, waiting: ready && !keys };
}

// Opening the library for a player: which API, and whether it can be used yet.
// Local mode is ready at once (a key is its own id). Online, the library stays
// "off" until the tables answer and the dictionary has been moved into them
// (the rows carry the old key), so a screen never shows up half-working.
import { getLibraryApi } from "./libraryApi";
import { identityIds, loadIds } from "./libraryIds";

// local: the local-mode wiring ({ storage, me, canSee, areFriends, nameOf }), or null online.
// Resolves to { status: "ready", api, ids } or { status: "off" }; never rejects.
export async function openLibrary({ local = null, client }) {
  try {
    if (local) return { status: "ready", api: getLibraryApi(local), ids: identityIds };
    const api = getLibraryApi();
    await api.tree();                                       // fails while the tables aren't there
    const { ids, words } = await loadIds(client);
    return words ? { status: "ready", api, ids } : { status: "off" };
  } catch { return { status: "off" }; }
}

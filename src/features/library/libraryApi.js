// The personal library and its views (folders inside folders), behind one
// interface with two interchangeable implementations:
//   online  - Supabase functions (migrations 0026-0030) do every check;
//   local   - the same calls over localStorage (local mode, and the tests),
//             mirroring the server's rules and messages.
// Screens depend on this interface, never on either implementation.
//
// LibraryApi (all calls return promises; ids are the server's ids, which in
// local mode are the game's own word and rule keys):
//   views      tree() create(name, parent?, source?) rename(id, name) move(id, parent?)
//              remove(id) add(view, senseIds) drop(view, senseId) addRules(view, ruleIds) dropRule(view, ruleId)
//              contents(view, deep?) -> [{ kind: "sense" | "rule", id }]
//   library    libraryAdd(senseIds) libraryRemove(senseId) libraryAddRules(ruleIds) libraryRemoveRule(ruleId) patch(senseId, patch, note?) createWord(card)
//              libraryList() -> { words: [{ id, note, patch, added_at, views }], rules: [{ id }] }
//   sharing    share(view, userIds) inbox() accept(shareId) dismiss(shareId)
//   links      linkCreate(view) linkInfo(token) linkAccept(token) linkRevoke(token)
//   catalog    catalogPublish(view, title, description?) catalogEdit(entry, title, description?) catalogUnpublish(entry) catalogList(query?, limit?) catalogTake(entry)
import { isLocalMode, supabase } from "../../lib/supabase";
import { createLocalLibraryApi } from "./local/localLibraryApi";
import { createOnlineLibraryApi } from "./onlineLibraryApi";

export { LibraryError } from "./libraryErrors";
export { LINK_DAYS, MAX_CATALOG, MAX_DEPTH, MAX_LIBRARY, MAX_LINKS, MAX_NAME, MAX_PER_CALL, MAX_SHARES_WAITING, MAX_SHARE_USERS, MAX_VIEWS, NAME_ERROR, cleanViewName, senseFromCard, validViewName } from "./libraryRules";
export { createLocalLibraryApi, createOnlineLibraryApi as createSupabaseLibraryApi };

// Online: the Supabase functions. Local mode: the localStorage mirror, which
// the app wires up with { storage, me, canSee, areFriends, nameOf }.
let shared = null;
export function getLibraryApi(local) {
  if (isLocalMode) return createLocalLibraryApi(local || { storage: globalThis.localStorage, me: () => "local" });
  return (shared ||= createOnlineLibraryApi(supabase));
}

// The library API over Supabase: every call is one database function
// (migrations 0026-0032) and the function does every check. This file only
// names the arguments.
import { friendlyError } from "./libraryErrors";
import { senseFromCard } from "./libraryRules";

export function createOnlineLibraryApi(client) {
  const rpc = async (fn, args) => {
    let data, error;
    try { ({ data, error } = await client.rpc(fn, args)); } catch (e) { throw friendlyError(e); }
    if (error) throw friendlyError(error);
    return data;
  };
  return {
    mode: "online",
    // views
    tree: () => rpc("view_tree"),
    create: (name, parent = null, source = null) => rpc("view_create", { p_name: name, p_parent: parent, p_source: source }),
    rename: (id, name) => rpc("view_edit", { p_id: id, p_name: name }),
    move: (id, parent = null) => rpc("view_edit", { p_id: id, p_move: true, p_parent: parent }),
    remove: (id) => rpc("view_remove", { p_id: id }),
    add: (view, senseIds) => rpc("view_add", { p_view: view, p_senses: senseIds }),
    drop: (view, senseId) => rpc("view_drop", { p_view: view, p_sense: senseId }),
    addRules: (view, ruleIds) => rpc("view_add_rules", { p_view: view, p_rules: ruleIds }),
    contents: (view, deep = true) => rpc("view_contents", { p_view: view, p_deep: deep }),
    // the library and the player's own words
    libraryAdd: (senseIds) => rpc("library_add", { p_senses: senseIds }),
    libraryList: () => rpc("library_list"),
    libraryRemove: (senseId) => rpc("library_remove", { p_sense: senseId }),
    patch: (senseId, patch, note = null) => rpc("library_patch", { p_sense: senseId, p_patch: patch, p_note: note }),
    createWord: (card) => {
      const w = senseFromCard(card);
      return rpc("sense_create", { p_word: w.word, p_type: w.type, p_pos: w.pos, p_category: w.category, p_meaning: w.meaning, p_content: w.content, p_source: w.source });
    },
    // sharing a view with friends
    share: (view, userIds) => rpc("view_share", { p_view: view, p_users: userIds }),
    inbox: () => rpc("view_shares_inbox"),
    accept: (shareId) => rpc("view_share_accept", { p_share: shareId }),
    dismiss: (shareId) => rpc("view_share_dismiss", { p_share: shareId }),
    // sharing a view by link
    linkCreate: (view) => rpc("view_link_create", { p_view: view }),
    linkInfo: (token) => rpc("view_link_info", { p_token: token }),
    linkAccept: (token) => rpc("view_link_accept", { p_token: token }),
    linkRevoke: (token) => rpc("view_link_revoke", { p_token: token }),
    // the catalog (migration 0032)
    catalogPublish: (view, title, description = "") => rpc("catalog_publish", { p_view: view, p_title: title, p_description: description }),
    catalogUnpublish: (entry) => rpc("catalog_unpublish", { p_entry: entry }),
    catalogList: (query = "", limit = 50) => rpc("catalog_list", { p_query: query, p_limit: limit }),
    catalogTake: (entry) => rpc("catalog_take", { p_entry: entry }),
  };
}

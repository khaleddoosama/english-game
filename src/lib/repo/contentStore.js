// Course content as one repo sees it: loaded through the browser's cache (only
// refreshed when the server's content version changes) and saved by admins as
// changed rows. The store owns the state that belongs only to content: what
// the server is known to hold (contentRows, contentMeta) and the version this
// device last saw. Created once for each repo; nothing else reads that state.
import { idb } from "../idb";
import { stableJson } from "../stableJson";
import { addNewToLibrary } from "../saveToLibrary";
import { contentFromCache, hasContent, planContentSave } from "./contentPlan";
import { fetchAll } from "./fetchAll";

const UPSERT_BATCH = 250;
const newDraftId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16 >> (c / 4))).toString(16)));


export function createContentStore({ sb, isAdmin }) {
  // Content state on the server.
  let contentRows = new Map();              // `${kind}\u0000${key}` -> { kind, key, json, position }
  let contentMeta = { levelOrder: "[]", note: "" };
  let contentVersion = null;                // content_meta.version this device last saw

  function rememberContent(cache) {
    contentRows = new Map(Object.entries(cache.items).map(([id, row]) => [id, { kind: row.kind, key: row.key, json: stableJson(row.data), position: row.position }]));
    contentMeta = { levelOrder: stableJson(cache.levelOrder || []), note: cache.note || "" };
    contentVersion = cache.version ?? null;
  }

  async function load() {
    const cache = await idb.get("content-cache");
    let meta;
    try {
      const { data, error } = await sb.from("content_meta").select("version, level_order, note").eq("id", 1).single();
      if (error) throw error;
      meta = data;
    } catch (e) {
      // Offline: play from the cache if there is one.
      if (cache) { rememberContent(cache); return contentFromCache(cache); }
      throw e;
    }
    if (cache && cache.version === meta.version) { rememberContent(cache); return hasContent(contentFromCache(cache)) ? contentFromCache(cache) : null; }
    const cols = "kind, key, data, position, deleted, updated_at";
    const incremental = !!(cache && cache.syncedAt);
    const rows = incremental
      ? await fetchAll(() => sb.from("content_items").select(cols).gt("updated_at", cache.syncedAt).order("updated_at").order("kind").order("key"))
      : await fetchAll(() => sb.from("content_items").select(cols).eq("deleted", false).order("kind").order("key"));
    const items = incremental ? { ...cache.items } : {};
    let syncedAt = incremental ? cache.syncedAt : null;
    for (const row of rows) {
      const id = `${row.kind}\u0000${row.key}`;
      if (row.deleted) delete items[id]; else items[id] = { kind: row.kind, key: row.key, data: row.data, position: row.position };
      if (!syncedAt || row.updated_at > syncedAt) syncedAt = row.updated_at;
    }
    const next = { version: meta.version, syncedAt, items, levelOrder: meta.level_order || [], note: meta.note || "" };
    await idb.set("content-cache", next);
    rememberContent(next);
    const content = contentFromCache(next);
    return hasContent(content) ? content : null;
  }

  // Admin only. Upserts changed items, tombstones removed ones. Positions keep
  // their order with gaps, so deleting or appending never renumbers the rest.
  // renames: [{ kind: "word" | "category", from, to }] applied to every
  // player's progress in the same transaction (content_save_v2).
  async function save(content, { renames = [] } = {}) {
    if (!isAdmin) return;
    const { upserts, removes, levelOrder, note, metaChanged } = planContentSave(content, contentRows, contentMeta);
    if (!upserts.length && !removes.length && !metaChanged && !renames.length) return;
    // One call when it fits; otherwise the batches go into a draft and the
    // last call publishes everything at once, so players never see half.
    const rows = upserts.map(({ json, ...row }) => row);
    const draft = rows.length > UPSERT_BATCH ? newDraftId() : null;
    for (let i = 0; i + UPSERT_BATCH < rows.length; i += UPSERT_BATCH) {
      const { error } = await sb.rpc("content_save_v2", { p_draft: draft, p_upserts: rows.slice(i, i + UPSERT_BATCH), p_removes: [], p_level_order: null, p_note: null, p_renames: null, p_expected_version: null, p_publish: false });
      if (error) throw error;
    }
    const lastStart = draft ? Math.floor((rows.length - 1) / UPSERT_BATCH) * UPSERT_BATCH : 0;
    const { data: result, error } = await sb.rpc("content_save_v2", {
      p_draft: draft, p_upserts: rows.slice(lastStart), p_removes: removes, p_level_order: levelOrder, p_note: note,
      p_renames: renames.length ? renames : null, p_expected_version: contentVersion, p_publish: true,
    });
    if (error) {
      if (error.code === "40001") throw Object.assign(new Error(error.message), { conflict: true });
      throw error;
    }
    const version = result?.version ?? null;
    contentVersion = version;
    // Keep the library's copy of the dictionary (migration 0027) in step. Best
    // effort: the game doesn't read it yet, and before that migration there is
    // nothing to call.
    // What is new in this save then joins the admin's own library (the senses exist once the sync is done).
    const fresh = upserts.filter((r) => !contentRows.has(`${r.kind}\u0000${r.key}`) && (r.kind === "words" || r.kind === "grammar"));
    Promise.resolve(sb.rpc("dictionary_sync"))
      .then((out) => {
        if (out?.error) { if (!["42883", "PGRST202"].includes(out.error.code)) console.warn("dictionary_sync:", out.error.message); return null; }
        return fresh.length ? addNewToLibrary(sb, fresh) : null;
      })
      .catch((e) => console.warn("library:", e?.message || e));
    for (const row of upserts) contentRows.set(`${row.kind}\u0000${row.key}`, { kind: row.kind, key: row.key, json: row.json, position: row.position });
    for (const r of removes) contentRows.delete(`${r.kind}\u0000${r.key}`);
    contentMeta = { levelOrder: stableJson(levelOrder), note };
    // Keep the admin's own cache current so the next start is a cache hit.
    const items = {};
    for (const [id, row] of contentRows) items[id] = { kind: row.kind, key: row.key, data: JSON.parse(row.json), position: row.position };
    const cache = await idb.get("content-cache");
    await idb.set("content-cache", { version, syncedAt: cache?.syncedAt || null, items, levelOrder, note });
  }

  return { load, save };
}

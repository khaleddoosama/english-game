// Where content and progress live. Two implementations with one interface:
// Supabase (the real app) and local (IndexedDB only, for development/tests).
//
// Content is one row per word/grammar/challenge/story/combo. Players read it
// through an IndexedDB cache that is only refreshed when the server's content
// version changes. Progress is saved as a diff: only changed sections and
// changed mastery records go over the wire. Every change is written to a
// local snapshot before it is sent, so closing the app mid-save loses
// nothing. Each section carries a revision: when another device wrote it
// first, the two are merged (progressMerge.js) instead of one overwriting
// the other.
import { supabase } from "./supabase";
import { idb } from "./idb";
import { V2 } from "../engine/v2";
import { isWordKey } from "../engine/data";
import { mergeMastery, mergeMasteryRecord, mergeSection } from "./progressMerge";

export const CONTENT_KINDS = ["words", "grammar", "challenges", "stories", "combos"];
const keyOf = (kind, item) => (kind === "words" ? item?.word : item?.id);
// Fields of a full backup that are content, never progress.
const CONTENT_FIELDS = new Set(["words", "combos", "stories", "grammar", "puns", "challenges", "levelOrder", "kind", "note", "contentSchemaVersion"]);
const SECTION_OF = {
  activeSession: "session", pools: "pools", seenSentences: "seen", confusions: "confusions",
  sessionLogs: "history", completedSessions: "history", solvedStories: "history", dailyHistory: "history",
  reports: "reports", levelStats: "levels", levelsCleared: "levels",
};
const PAGE = 1000, UPSERT_BATCH = 250, POSITION_GAP = 1000, RETRY_MS = 15000;
const newDraftId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16 >> (c / 4))).toString(16)));

export { stableJson } from "./stableJson";
import { stableJson } from "./stableJson";

const emptyContent = () => ({ words: [], grammar: [], challenges: [], stories: [], combos: [], levelOrder: [], note: "" });
const hasContent = (c) => !!c && CONTENT_KINDS.some((k) => (c[k] || []).length);

// Progress object -> { section: {field: value} }, content fields dropped.
function splitSections(data) {
  const out = {};
  for (const [field, value] of Object.entries(data || {})) {
    if (field === "mastery" || CONTENT_FIELDS.has(field) || value === undefined) continue;
    const section = SECTION_OF[field] || "core";
    (out[section] ||= {})[field] = value;
  }
  return out;
}

// Monday of this week, local time, as YYYY-MM-DD.
export function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Leaderboard numbers the server can't work out itself (score, streaks and
// this week's points come from the saved progress).
const profileSummary = (data) => ({ mastered_count: masteredCount(data.mastery), week_start: weekStart() });

const hasServerRows = (sections, masteryRows) => sections.length > 0 || masteryRows.length > 0;

function masteredCount(mastery) {
  let n = 0;
  for (const [key, stats] of Object.entries(mastery || {})) if (isWordKey(key) && V2.stage(stats) === "Mastered") n++;
  return n;
}

// Status listeners: the header shows saving / offline / error.
function statusHub() {
  const subs = new Set();
  let current = "idle";
  return {
    get: () => current,
    set(next) { if (next === current) return; current = next; subs.forEach((fn) => fn(next)); },
    subscribe(fn) { subs.add(fn); fn(current); return () => subs.delete(fn); },
  };
}

// Diff tracker for mastery: reference check first (records are replaced, not
// mutated), JSON compare only for records whose reference changed.
function masteryDiff(prevRefs, prevJson, next) {
  const upserts = {}, removes = [];
  for (const [key, stats] of Object.entries(next || {})) {
    if (prevRefs.get(key) === stats) continue;
    const json = stableJson(stats);
    if (prevJson.get(key) !== json) upserts[key] = stats;
  }
  for (const key of prevJson.keys()) if (!next || !(key in next)) removes.push(key);
  return { upserts, removes };
}

/* ------------------------------------------------------------ Supabase */

export function createSupabaseRepo({ userId, isAdmin, client = supabase }) {
  const sb = client;
  const status = statusHub();
  const snapshotKey = `progress:${userId}`;
  // Last state known to be on the server.
  let savedSections = new Map();            // section -> json
  let savedMasteryJson = new Map();         // key -> json
  let savedMasteryRefs = new Map();         // key -> object
  let savedProfile = "";
  let savedRevs = new Map();                // section -> revision on the server
  let masterySince = "";                    // newest mastery updated_at seen
  let savedReports = new Map();             // id -> json (own reports, as in the reports table)
  let savedRemoteReports = new Map();       // id -> json (other players', admin only)
  let lastLocal = null;                     // the app's newest progress
  const mergedSubs = new Set();             // told when another device's changes were merged in
  const notifyMerged = (data) => { for (const fn of mergedSubs) { try { fn(data); } catch (e) { console.error(e); } } };
  // Content state on the server.
  let contentRows = new Map();              // `${kind}\u0000${key}` -> { kind, key, json, position }
  let contentMeta = { levelOrder: "[]", note: "" };
  let contentVersion = null;                // content_meta.version this device last saw

  async function fetchAll(build) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  function contentFromCache(cache) {
    const out = emptyContent();
    const rows = Object.values(cache.items).sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : 1));
    for (const row of rows) out[row.kind].push(row.data);
    out.levelOrder = cache.levelOrder || [];
    out.note = cache.note || "";
    return out;
  }
  function rememberContent(cache) {
    contentRows = new Map(Object.entries(cache.items).map(([id, row]) => [id, { kind: row.kind, key: row.key, json: stableJson(row.data), position: row.position }]));
    contentMeta = { levelOrder: stableJson(cache.levelOrder || []), note: cache.note || "" };
    contentVersion = cache.version ?? null;
  }

  async function loadContent() {
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
  async function saveContent(content, { renames = [] } = {}) {
    if (!isAdmin) return;
    const upserts = [], seen = new Set();
    for (const kind of CONTENT_KINDS) {
      const list = content[kind] || [];
      const ids = list.map((item) => { const key = keyOf(kind, item); return key === undefined || key === null || key === "" ? null : `${kind}\u0000${key}`; });
      // Stored position of the next already-saved item, for slotting new items between neighbours.
      const nextStored = new Array(list.length).fill(null);
      for (let i = list.length - 2; i >= 0; i--) { const r = ids[i + 1] && contentRows.get(ids[i + 1]); nextStored[i] = r ? r.position : nextStored[i + 1]; }
      let prevPos = -Infinity;
      list.forEach((item, i) => {
        const id = ids[i];
        if (!id || seen.has(id)) return;
        seen.add(id);
        const prev = contentRows.get(id);
        let position;
        if (prev && prev.position > prevPos) position = prev.position;
        else {
          const next = nextStored[i];
          if (next === null || next <= prevPos) position = prevPos === -Infinity ? 0 : Math.floor(prevPos / POSITION_GAP) * POSITION_GAP + POSITION_GAP;
          else {
            const low = prevPos === -Infinity ? next - 2 * POSITION_GAP : prevPos;
            position = low + Math.floor((next - low) / 2);
          }
          if (position <= prevPos) position = prevPos + 1;
        }
        prevPos = position;
        const json = stableJson(item);
        if (!prev || prev.json !== json || prev.position !== position) upserts.push({ kind, key: String(keyOf(kind, item)), data: item, position, json });
      });
    }
    const removes = [...contentRows.entries()].filter(([id]) => !seen.has(id)).map(([, row]) => ({ kind: row.kind, key: row.key }));
    const levelOrder = content.levelOrder || [];
    const note = content.note || "";
    const metaChanged = stableJson(levelOrder) !== contentMeta.levelOrder || note !== contentMeta.note;
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
    for (const row of upserts) contentRows.set(`${row.kind}\u0000${row.key}`, { kind: row.kind, key: row.key, json: row.json, position: row.position });
    for (const r of removes) contentRows.delete(`${r.kind}\u0000${r.key}`);
    contentMeta = { levelOrder: stableJson(levelOrder), note };
    // Keep the admin's own cache current so the next start is a cache hit.
    const items = {};
    for (const [id, row] of contentRows) items[id] = { kind: row.kind, key: row.key, data: JSON.parse(row.json), position: row.position };
    const cache = await idb.get("content-cache");
    await idb.set("content-cache", { version, syncedAt: cache?.syncedAt || null, items, levelOrder, note });
  }

  async function loadProgress() {
    const snapshot = await idb.get(snapshotKey);
    let sections, masteryRows, ownReportRows, reportRows = [];
    try {
      [sections, masteryRows, ownReportRows] = await Promise.all([
        fetchAll(() => sb.from("progress").select("section, data, rev").eq("user_id", userId).order("section")),
        fetchAll(() => sb.from("mastery").select("item_key, stats, updated_at").eq("user_id", userId).order("item_key")),
        fetchAll(() => sb.from("reports").select("id, data, resolved_at").eq("user_id", userId).order("id")),
      ]);
      if (isAdmin) {
        reportRows = await fetchAll(() => sb.from("reports").select("id, data, resolved_at, created_at, user_id, profiles:user_id(username)").neq("user_id", userId).order("created_at"));
      }
    } catch (e) {
      if (snapshot?.data) { status.set("offline"); lastLocal = snapshot.data; return snapshot.data; }
      throw e;
    }
    const data = {};
    const serverSections = {};
    for (const s of sections) {
      serverSections[s.section] = s.data;
      Object.assign(data, s.data);
      savedSections.set(s.section, stableJson(s.data));
      savedRevs.set(s.section, Number(s.rev) || 1);
    }
    const mastery = {};
    for (const row of masteryRows) {
      mastery[row.item_key] = row.stats; savedMasteryJson.set(row.item_key, stableJson(row.stats));
      if (row.updated_at && row.updated_at > masterySince) masterySince = row.updated_at;
    }
    data.mastery = mastery;
    if (hasServerRows(sections, masteryRows)) savedProfile = stableJson(profileSummary(data));
    const sectionReports = serverSections.reports?.reports || [];
    // Other players' reports: shown in Admin, tracked separately.
    const remote = reportRows.map((row) => ({ ...row.data, resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : row.data.resolvedAt || null, _remote: true, _from: row.profiles?.username || "player", _filedAt: row.created_at || null }));
    for (const r of remote) savedRemoteReports.set(r.id, stableJson(r));
    const hasServer = hasServerRows(sections, masteryRows);
    // Play from this device that never reached the server: merge it with
    // whatever other devices saved meanwhile; the next save sends it.
    if (snapshot?.dirty && snapshot.data) {
      const merged = mergeUnsynced(snapshot, serverSections, mastery);
      merged.reports = [...reconcileReports((merged.reports || []).filter((r) => !r?._remote), sectionReports, ownReportRows), ...remote];
      lastLocal = merged;
      return merged;
    }
    if (data.reports) data.reports = reconcileReports(data.reports, sectionReports, ownReportRows);
    if (remote.length) data.reports = [...(data.reports || []), ...remote];
    const out = hasServer || remote.length ? data : null;
    lastLocal = out;
    return out;
  }

  // A dirty snapshot against the server's current progress. Sections the
  // server hasn't changed since the snapshot's base keep this device's
  // values; changed ones are merged field by field.
  function mergeUnsynced(snapshot, serverSections, serverMastery) {
    const local = snapshot.data;
    const base = snapshot.base || { revs: {}, sections: {} };
    const localSections = splitSections(local);
    const out = { ...local };
    for (const [name, server] of Object.entries(serverSections)) {
      if (base.revs?.[name] != null && base.revs[name] === savedRevs.get(name)) continue;
      const baseSection = base.sections?.[name] ? JSON.parse(base.sections[name]) : null;
      Object.assign(out, mergeSection(baseSection, localSections[name], server));
    }
    out.mastery = mergeMastery(null, local.mastery, serverMastery);
    return out;
  }

  // The player's own reports: the reports table has the admin's decisions
  // (resolved, deleted, notes added); this device has what it changed since
  // its last save. A report the server's progress lists but the table
  // doesn't have was deleted; one only this device has wasn't sent yet.
  // Reports filed on another device arrive with that device's progress.
  function reconcileReports(local, sectionReports, rows) {
    const table = new Map(rows.map((row) => [row.id, row]));
    const sent = new Map(sectionReports.filter((r) => r?.id).map((r) => [r.id, stableJson(r)]));
    const out = [];
    for (const r of local) {
      if (!r?.id) { out.push(r); continue; }
      const row = table.get(r.id);
      if (!row) { if (!sent.has(r.id)) out.push(r); continue; }
      const resolvedAt = row.resolved_at ? Date.parse(row.resolved_at) : null;
      const fromTable = { ...row.data, resolvedAt };
      savedReports.set(r.id, stableJson(fromTable));
      const changedHere = sent.has(r.id) && sent.get(r.id) !== stableJson(r);
      out.push(!changedHere ? fromTable : isAdmin ? r : { ...r, resolvedAt });
    }
    return out;
  }

  async function syncReports(own, remote) {
    const nextOwn = new Map(own.filter((r) => r?.id).map((r) => [r.id, stableJson(r)]));
    // Only the admin decides whether a report is resolved; the server keeps
    // that part of a player's report as it is, whatever the player sends.
    const upserts = [...nextOwn].filter(([id, json]) => savedReports.get(id) !== json).map(([id, json]) => {
      const data = JSON.parse(json);
      return isAdmin ? { id, data, resolved_at: data.resolvedAt ? new Date(data.resolvedAt).toISOString() : null } : { id, data };
    });
    // A player's device keeps only the newest resolved reports; dropping
    // older ones there doesn't delete them for the admin.
    const deletes = [...savedReports].filter(([id, json]) => !nextOwn.has(id) && (isAdmin || !JSON.parse(json).resolvedAt)).map(([id]) => id);
    if (upserts.length) {
      const { error } = await sb.from("reports").upsert(upserts);
      if (error && error.code !== "42501") throw error;
      // A report someone else filed (in a backup imported here) can't be
      // written by this player: skip it instead of failing every save. The
      // next start drops it from this player's list.
      if (error) for (const row of upserts) { const { error: e } = await sb.from("reports").upsert([row]); if (e && e.code !== "42501") throw e; }
    }
    if (deletes.length) { const { error } = await sb.from("reports").delete().in("id", deletes); if (error) throw error; }
    savedReports = nextOwn;
    if (!isAdmin) return;
    const nextRemote = new Map(remote.map((r) => [r.id, stableJson(r)]));
    for (const [id, json] of nextRemote) {
      if (savedRemoteReports.get(id) === json) continue;
      const { _remote, _from, _filedAt, ...report } = JSON.parse(json);
      const { error } = await sb.from("reports").update({ data: report, resolved_at: report.resolvedAt ? new Date(report.resolvedAt).toISOString() : null }).eq("id", id);
      if (error) throw error;
    }
    const gone = [...savedRemoteReports.keys()].filter((id) => !nextRemote.has(id));
    if (gone.length) { const { error } = await sb.from("reports").delete().in("id", gone); if (error) throw error; }
    savedRemoteReports = nextRemote;
  }

  // Sends what changed. When another device wrote one of the sections
  // first, merges with its copy and tries again. Returns the data actually
  // saved (merged, if it had to be).
  async function pushProgress(input, replace = false) {
    let data = input;
    for (let attempt = 0; attempt < 4; attempt++) {
      const reports = Array.isArray(data.reports) ? data.reports : [];
      const own = reports.filter((r) => !r?._remote), remote = reports.filter((r) => r?._remote);
      const sections = splitSections({ ...data, reports: own });
      const changedSections = {};
      for (const [name, value] of Object.entries(sections)) {
        if (replace || savedSections.get(name) !== stableJson(value)) changedSections[name] = value;
      }
      const { upserts, removes } = masteryDiff(savedMasteryRefs, savedMasteryJson, data.mastery);
      const profile = profileSummary(data);
      const profileJson = stableJson(profile);
      const reportsChanged = own.some((r) => r?.id && savedReports.get(r.id) !== stableJson(r)) || own.filter((r) => r?.id).length !== savedReports.size
        || (isAdmin && (remote.length !== savedRemoteReports.size || remote.some((r) => savedRemoteReports.get(r.id) !== stableJson(r))));
      if (!Object.keys(changedSections).length && !Object.keys(upserts).length && !removes.length && profileJson === savedProfile && !reportsChanged) return data;
      // Reports go first: the progress that lists a report is never on the
      // server before the report itself (see reconcileReports).
      if (reportsChanged) await syncReports(own, remote);
      const expected = Object.fromEntries(Object.keys(changedSections).map((name) => [name, savedRevs.get(name) ?? null]));
      const { data: result, error } = await sb.rpc("save_progress_v2", {
        p_sections: changedSections, p_expected: expected, p_mastery: upserts, p_mastery_removes: removes, p_profile: profile, p_replace: !!replace,
      });
      if (error) throw error;
      if (result?.conflict) {
        // Another device saved first: take its copy as the new base and
        // merge this device's changes into it.
        const merged = { ...data };
        for (const name of result.conflict) {
          const server = result.sections?.[name] || { data: {}, rev: null };
          const base = savedSections.has(name) ? JSON.parse(savedSections.get(name)) : null;
          Object.assign(merged, mergeSection(base, sections[name], server.data));
          savedSections.set(name, stableJson(server.data));
          savedRevs.set(name, Number(server.rev) || null);
        }
        // Other players' reports (admin) aren't part of the saved sections: keep them.
        if (remote.length) merged.reports = [...(merged.reports || []).filter((r) => !r?._remote), ...remote];
        data = merged;
        lastLocal = merged;
        notifyMerged(merged);
        continue;
      }
      for (const [name, value] of Object.entries(changedSections)) savedSections.set(name, stableJson(value));
      for (const [name, rev] of Object.entries(result?.revs || {})) savedRevs.set(name, Number(rev));
      for (const [key, stats] of Object.entries(upserts)) savedMasteryJson.set(key, stableJson(stats));
      for (const key of removes) savedMasteryJson.delete(key);
      savedMasteryRefs = new Map(Object.entries(data.mastery || {}));
      savedProfile = profileJson;
      return data;
    }
    throw new Error("Progress kept changing on another device; will try again.");
  }

  // Another device may have played since this one loaded: bring its
  // changes in (the app calls this when it comes back to the foreground).
  async function refreshProgress() {
    if (running || latest || !lastLocal) return false;
    let revRows, masteryRows;
    try {
      [revRows, masteryRows] = await Promise.all([
        fetchAll(() => sb.from("progress").select("section, rev").eq("user_id", userId).order("section")),
        fetchAll(() => { let q = sb.from("mastery").select("item_key, stats, updated_at").eq("user_id", userId); if (masterySince) q = q.gt("updated_at", masterySince); return q.order("item_key"); }),
      ]);
    } catch { return false; }
    const changed = revRows.filter((r) => savedRevs.get(r.section) !== Number(r.rev)).map((r) => r.section);
    const masteryChanged = masteryRows.filter((r) => savedMasteryJson.get(r.item_key) !== stableJson(r.stats));
    if (!changed.length && !masteryChanged.length) return false;
    if (running || latest) return false; // this device saved meanwhile; its save merges instead
    let rows = [];
    if (changed.length) {
      try { rows = await fetchAll(() => sb.from("progress").select("section, data, rev").eq("user_id", userId).in("section", changed).order("section")); } catch { return false; }
    }
    const local = lastLocal;
    const remoteReports = (local.reports || []).filter((r) => r?._remote);
    const localSections = splitSections({ ...local, reports: (local.reports || []).filter((r) => !r?._remote) });
    const merged = { ...local };
    for (const row of rows) {
      const base = savedSections.has(row.section) ? JSON.parse(savedSections.get(row.section)) : null;
      Object.assign(merged, mergeSection(base, localSections[row.section], row.data));
      savedSections.set(row.section, stableJson(row.data));
      savedRevs.set(row.section, Number(row.rev));
    }
    if (masteryChanged.length) {
      merged.mastery = { ...(local.mastery || {}) };
      for (const row of masteryChanged) {
        const base = savedMasteryJson.has(row.item_key) ? JSON.parse(savedMasteryJson.get(row.item_key)) : undefined;
        merged.mastery[row.item_key] = mergeMasteryRecord(base, local.mastery?.[row.item_key], row.stats);
        savedMasteryJson.set(row.item_key, stableJson(row.stats));
        if (row.updated_at && row.updated_at > masterySince) masterySince = row.updated_at;
      }
    }
    if (remoteReports.length) merged.reports = [...(merged.reports || []).filter((r) => !r?._remote), ...remoteReports];
    lastLocal = merged;
    notifyMerged(merged);
    return true;
  }

  // Saves coalesce: while one is in flight, only the newest state waits.
  // Each state is in the local snapshot (dirty) before it is sent; only the
  // newest state, once on the server, marks the snapshot clean.
  let latest = null, running = null, retryTimer = null, localRev = 0;
  let idbQueue = Promise.resolve();
  const writeSnapshot = (snap) => (idbQueue = idbQueue.then(async () => {
    const ok = await idb.set(snapshotKey, snap);
    if (!ok) { status.set("error"); console.error("Couldn't keep a copy of progress on this device (storage full or blocked)."); }
    return ok;
  }));
  const baseForSnapshot = () => ({ revs: Object.fromEntries(savedRevs), sections: Object.fromEntries(savedSections) });
  async function flush() {
    if (running) return running;
    running = (async () => {
      while (latest) {
        const item = latest; latest = null;
        status.set("saving");
        try {
          const saved = await pushProgress(item.data, item.replace);
          if (!latest && item.rev === localRev) await writeSnapshot({ data: saved, dirty: false, rev: item.rev, at: Date.now() });
          status.set(latest ? "saving" : "saved");
        } catch (e) {
          if (!latest) latest = item;
          await writeSnapshot({ data: latest.data, dirty: true, rev: latest.rev, at: Date.now(), base: baseForSnapshot() });
          status.set(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
          console.error("Progress save failed; will retry", e);
          clearTimeout(retryTimer);
          retryTimer = setTimeout(flush, RETRY_MS);
          break;
        }
      }
    })().finally(() => { running = null; });
    return running;
  }
  const onOnline = () => { if (latest) flush(); };
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);

  return {
    mode: "supabase",
    status,
    loadContent,
    saveContent,
    loadProgress,
    // replace: a restored backup; it overwrites instead of merging.
    async saveProgress(data, { replace = false } = {}) {
      const rev = ++localRev;
      lastLocal = data;
      latest = { data, rev, replace: replace || !!latest?.replace };
      await writeSnapshot({ data, dirty: true, rev, at: Date.now(), base: baseForSnapshot() });
      return flush();
    },
    refreshProgress,
    onMerged(fn) { mergedSubs.add(fn); return () => mergedSubs.delete(fn); },
    async resetProgress() {
      latest = null; localRev++;
      if (running) await running.catch(() => {});
      const { error } = await sb.rpc("reset_my_progress");
      if (error) throw error;
      savedSections = new Map(); savedRevs = new Map(); savedMasteryJson = new Map(); savedMasteryRefs = new Map(); savedProfile = ""; lastLocal = null;
      await (idbQueue = idbQueue.then(() => idb.del(snapshotKey)));
    },
    async wipeContent() { await saveContent(emptyContent()); },
    dispose() { if (typeof window !== "undefined") window.removeEventListener("online", onOnline); clearTimeout(retryTimer); },
  };
}

/* --------------------------------------------------------------- local */

export function createLocalRepo() {
  const status = statusHub();
  return {
    mode: "local",
    status,
    async loadContent() { const c = await idb.get("local:content"); return hasContent(c) ? c : null; },
    async saveContent(content) { if (!(await idb.set("local:content", { ...emptyContent(), ...content }))) throw new Error("This browser didn't let the game store its content (storage full or blocked)."); },
    async loadProgress() { return (await idb.get("local:progress")) || null; },
    async saveProgress(data) {
      status.set("saving");
      const clean = {};
      for (const [k, v] of Object.entries(data)) if (!CONTENT_FIELDS.has(k)) clean[k] = v;
      status.set((await idb.set("local:progress", clean)) ? "saved" : "error");
    },
    async resetProgress() { await idb.del("local:progress"); },
    async wipeContent() { await idb.del("local:content"); },
    dispose() {},
  };
}

// Exposed for tests.
export const _internals = { splitSections, weekStart, masteryDiff };

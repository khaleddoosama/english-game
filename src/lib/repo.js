// Where content and progress live. Two implementations with one interface:
// Supabase (the real app) and local (IndexedDB only, for development/tests).
//
// Content is one row per word/grammar/challenge/story/combo. Players read it
// through an IndexedDB cache that is only refreshed when the server's content
// version changes. Progress is saved as a diff: only changed sections and
// changed mastery records go over the wire, and a local snapshot keeps
// offline play safe until the next successful save.
import { supabase } from "./supabase";
import { idb } from "./idb";
import { V2 } from "../engine/v2";
import { isWordKey } from "../engine/data";

export const CONTENT_KINDS = ["words", "grammar", "challenges", "stories", "combos"];
const keyOf = (kind, item) => (kind === "words" ? item?.word : item?.id);
// Fields of a full backup that are content, never progress.
const CONTENT_FIELDS = new Set(["words", "combos", "stories", "grammar", "puns", "challenges", "levelOrder", "kind", "note", "contentSchemaVersion"]);
const SECTION_OF = {
  activeSession: "session", pools: "pools", seenSentences: "seen", confusions: "confusions",
  sessionLogs: "history", completedSessions: "history", solvedStories: "history",
  reports: "reports", levelStats: "levels", levelsCleared: "levels",
};
const PAGE = 1000, UPSERT_BATCH = 250, POSITION_GAP = 1000, RETRY_MS = 15000;

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
    const json = JSON.stringify(stats);
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
  let savedReports = new Map();             // id -> json (own reports)
  let savedRemoteReports = new Map();       // id -> json (other players', admin only)
  let week = { start: null, base: 0 };
  let lastScore = null;                     // score in the last successful save
  // Content state on the server.
  let contentRows = new Map();              // `${kind}\u0000${key}` -> { kind, key, json, position }
  let contentMeta = { levelOrder: "[]", note: "" };

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
    contentRows = new Map(Object.entries(cache.items).map(([id, row]) => [id, { kind: row.kind, key: row.key, json: JSON.stringify(row.data), position: row.position }]));
    contentMeta = { levelOrder: JSON.stringify(cache.levelOrder || []), note: cache.note || "" };
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
  async function saveContent(content) {
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
        const json = JSON.stringify(item);
        if (!prev || prev.json !== json || prev.position !== position) upserts.push({ kind, key: String(keyOf(kind, item)), data: item, position, json });
      });
    }
    const removes = [...contentRows.entries()].filter(([id]) => !seen.has(id)).map(([, row]) => ({ kind: row.kind, key: row.key }));
    const levelOrder = content.levelOrder || [];
    const note = content.note || "";
    const metaChanged = JSON.stringify(levelOrder) !== contentMeta.levelOrder || note !== contentMeta.note;
    if (!upserts.length && !removes.length && !metaChanged) return;
    let version = null;
    for (let i = 0; i < Math.max(1, upserts.length); i += UPSERT_BATCH) {
      const batch = upserts.slice(i, i + UPSERT_BATCH);
      const last = i + UPSERT_BATCH >= upserts.length;
      const { data, error } = await sb.rpc("apply_content_changes", {
        p_upserts: batch.map(({ json, ...row }) => row),
        p_removes: last ? removes : [],
        p_level_order: levelOrder,
        p_note: note,
      });
      if (error) throw error;
      version = data;
      for (const row of batch) contentRows.set(`${row.kind}\u0000${row.key}`, { kind: row.kind, key: row.key, json: row.json, position: row.position });
    }
    for (const r of removes) contentRows.delete(`${r.kind}\u0000${r.key}`);
    contentMeta = { levelOrder: JSON.stringify(levelOrder), note };
    // Keep the admin's own cache current so the next start is a cache hit.
    const items = {};
    for (const [id, row] of contentRows) items[id] = { kind: row.kind, key: row.key, data: JSON.parse(row.json), position: row.position };
    const cache = await idb.get("content-cache");
    await idb.set("content-cache", { version, syncedAt: cache?.syncedAt || null, items, levelOrder, note });
  }

  async function loadProgress() {
    const snapshot = await idb.get(snapshotKey);
    let sections, masteryRows, reportRows = [];
    try {
      [sections, masteryRows] = await Promise.all([
        fetchAll(() => sb.from("progress").select("section, data").eq("user_id", userId).order("section")),
        fetchAll(() => sb.from("mastery").select("item_key, stats").eq("user_id", userId).order("item_key")),
      ]);
      if (isAdmin) {
        reportRows = await fetchAll(() => sb.from("reports").select("id, data, resolved_at, user_id, profiles:user_id(username)").neq("user_id", userId).order("created_at"));
      }
    } catch (e) {
      if (snapshot?.data) { status.set("offline"); return snapshot.data; }
      throw e;
    }
    const data = {};
    for (const s of sections) { Object.assign(data, s.data); savedSections.set(s.section, JSON.stringify(s.data)); }
    const mastery = {};
    for (const row of masteryRows) { mastery[row.item_key] = row.stats; savedMasteryJson.set(row.item_key, JSON.stringify(row.stats)); }
    data.mastery = mastery;
    week = data._week && typeof data._week === "object" ? { start: data._week.start || null, base: Number(data._week.base) || 0 } : { start: null, base: 0 };
    lastScore = hasServerRows(sections, masteryRows) ? Number(data.score) || 0 : null;
    for (const r of data.reports || []) if (r?.id) savedReports.set(r.id, JSON.stringify(r));
    // Other players' reports: shown in Admin, tracked separately.
    const remote = reportRows.map((row) => ({ ...row.data, resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : row.data.resolvedAt || null, _remote: true, _from: row.profiles?.username || "player" }));
    for (const r of remote) savedRemoteReports.set(r.id, JSON.stringify(r));
    if (remote.length) data.reports = [...(data.reports || []), ...remote];
    const hasServer = hasServerRows(sections, masteryRows);
    // Unsynced offline play wins over the server copy; the next save pushes it.
    if (snapshot?.dirty && snapshot.data) return { ...snapshot.data, reports: [...(snapshot.data.reports || []).filter((r) => !r?._remote), ...remote] };
    return hasServer || remote.length ? data : null;
  }

  async function syncReports(own, remote) {
    const nextOwn = new Map(own.filter((r) => r?.id).map((r) => [r.id, JSON.stringify(r)]));
    const upserts = [...nextOwn].filter(([id, json]) => savedReports.get(id) !== json).map(([id, json]) => ({ id, data: JSON.parse(json), resolved_at: JSON.parse(json).resolvedAt ? new Date(JSON.parse(json).resolvedAt).toISOString() : null }));
    const deletes = [...savedReports.keys()].filter((id) => !nextOwn.has(id));
    if (upserts.length) { const { error } = await sb.from("reports").upsert(upserts); if (error) throw error; }
    if (deletes.length) { const { error } = await sb.from("reports").delete().in("id", deletes); if (error) throw error; }
    savedReports = nextOwn;
    if (!isAdmin) return;
    const nextRemote = new Map(remote.map((r) => [r.id, JSON.stringify(r)]));
    for (const [id, json] of nextRemote) {
      if (savedRemoteReports.get(id) === json) continue;
      const { _remote, _from, ...report } = JSON.parse(json);
      const { error } = await sb.from("reports").update({ data: report, resolved_at: report.resolvedAt ? new Date(report.resolvedAt).toISOString() : null }).eq("id", id);
      if (error) throw error;
    }
    const gone = [...savedRemoteReports.keys()].filter((id) => !nextRemote.has(id));
    if (gone.length) { const { error } = await sb.from("reports").delete().in("id", gone); if (error) throw error; }
    savedRemoteReports = nextRemote;
  }

  async function pushProgress(data) {
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const own = reports.filter((r) => !r?._remote), remote = reports.filter((r) => r?._remote);
    const score = Number(data.score) || 0;
    // This week's points = score now minus the score when the week began.
    const thisWeek = weekStart();
    if (week.start !== thisWeek) week = { start: thisWeek, base: lastScore ?? score };
    if (score < week.base) week = { start: thisWeek, base: 0 }; // progress was reset
    const sections = splitSections({ ...data, reports: own, _week: week });
    const changedSections = {};
    for (const [name, value] of Object.entries(sections)) {
      const json = JSON.stringify(value);
      if (savedSections.get(name) !== json) changedSections[name] = value;
    }
    const { upserts, removes } = masteryDiff(savedMasteryRefs, savedMasteryJson, data.mastery);
    const profile = {
      score, mastered_count: masteredCount(data.mastery), study_streak: Number(data.studyStreak) || 0,
      best_study_streak: Number(data.bestStudyStreak) || 0, week_start: week.start, week_score: Math.max(0, score - week.base),
    };
    const profileJson = JSON.stringify(profile);
    const reportsChanged = own.some((r) => r?.id && savedReports.get(r.id) !== JSON.stringify(r)) || own.filter((r) => r?.id).length !== savedReports.size
      || (isAdmin && (remote.length !== savedRemoteReports.size || remote.some((r) => savedRemoteReports.get(r.id) !== JSON.stringify(r))));
    if (!Object.keys(changedSections).length && !Object.keys(upserts).length && !removes.length && profileJson === savedProfile && !reportsChanged) return;
    const { error } = await sb.rpc("save_progress", {
      p_sections: changedSections, p_mastery: upserts, p_mastery_removes: removes, p_profile: profileJson === savedProfile ? null : profile,
    });
    if (error) throw error;
    for (const [name, value] of Object.entries(changedSections)) savedSections.set(name, JSON.stringify(value));
    for (const [key, stats] of Object.entries(upserts)) savedMasteryJson.set(key, JSON.stringify(stats));
    for (const key of removes) savedMasteryJson.delete(key);
    savedMasteryRefs = new Map(Object.entries(data.mastery || {}));
    savedProfile = profileJson;
    lastScore = score;
    if (reportsChanged) await syncReports(own, remote);
  }

  // Saves coalesce: while one is in flight, only the newest state waits.
  let latest = null, running = null, retryTimer = null;
  async function flush() {
    if (running) return running;
    running = (async () => {
      while (latest) {
        const data = latest; latest = null;
        status.set("saving");
        try {
          await pushProgress(data);
          await idb.set(snapshotKey, { data, dirty: false, at: Date.now() });
          status.set(latest ? "saving" : "saved");
        } catch (e) {
          if (!latest) latest = data;
          await idb.set(snapshotKey, { data: latest, dirty: true, at: Date.now() });
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
    saveProgress(data) { latest = data; return flush(); },
    async resetProgress() {
      latest = null;
      const { error } = await sb.rpc("reset_my_progress");
      if (error) throw error;
      savedSections = new Map(); savedMasteryJson = new Map(); savedMasteryRefs = new Map(); savedProfile = ""; week = { start: null, base: 0 }; lastScore = 0;
      await idb.del(snapshotKey);
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
    async saveContent(content) { await idb.set("local:content", { ...emptyContent(), ...content }); },
    async loadProgress() { return (await idb.get("local:progress")) || null; },
    async saveProgress(data) {
      status.set("saving");
      const clean = {};
      for (const [k, v] of Object.entries(data)) if (!CONTENT_FIELDS.has(k)) clean[k] = v;
      await idb.set("local:progress", clean);
      status.set("saved");
    },
    async resetProgress() { await idb.del("local:progress"); },
    async wipeContent() { await idb.del("local:content"); },
    dispose() {},
  };
}

// Exposed for tests.
export const _internals = { splitSections, weekStart, masteryDiff };

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
import { mergeMasteryRecord, mergeSection } from "./progressMerge";
import { emptyContent } from "./repo/contentPlan";
import { createContentStore } from "./repo/contentStore";
import { fetchAll } from "./repo/fetchAll";
import { hasServerRows, masteryDiff, profileSummary, splitSections, weekStart } from "./repo/progressShape";
import { createReportsSync } from "./repo/reportsSync";
import { baseAfter, inflightOf, lacksOpSupport, newOpId, wasNotApplied } from "./repo/saveOps";
import { createStatusHub } from "./repo/status";
import { mergeUnsynced } from "./repo/unsyncedMerge";

export { CONTENT_KINDS } from "./repo/contentPlan";
export { weekStart } from "./repo/progressShape";
const RETRY_MS = 15000;
export { stableJson } from "./stableJson";
import { stableJson } from "./stableJson";

/* ------------------------------------------------------------ Supabase */

export function createSupabaseRepo({ userId, isAdmin, client = supabase }) {
  const sb = client;
  const status = createStatusHub();
  const snapshotKey = `progress:${userId}`;
  // Last state known to be on the server.
  let savedSections = new Map();            // section -> json
  let savedMasteryJson = new Map();         // key -> json
  let savedMasteryRefs = new Map();         // key -> object
  let savedProfile = "";
  let savedRevs = new Map();                // section -> revision on the server
  let masterySince = "";                    // newest mastery updated_at seen
  let lastLocal = null;                     // the app's newest progress
  // A save that was sent and not answered yet: { op, args }. Kept in the snapshot, so a closed page
  // can ask the database about it again. Resolved before anything newer is sent or merged (saveOps.js).
  let inflight = null;
  let opsSupported = true;                  // false once the database said it does not know operation ids
  const mergedSubs = new Set();             // told when another device's changes were merged in
  const notifyMerged = (data) => { for (const fn of mergedSubs) { try { fn(data); } catch (e) { console.error(e); } } };
  // Reports: what the reports table is known to hold lives in this store.
  const reportsSync = createReportsSync({ sb, isAdmin });
  // Content: its own state (what the server holds, its version) lives in the store.
  const content = createContentStore({ sb, isAdmin });

  // One call of save_progress_v2. With an operation id; against a database that does not know ids it is
  // sent without one (and no more ids are sent), as the version before migration 0042 worked.
  async function callSave(args, op) {
    if (opsSupported) {
      const res = await sb.rpc("save_progress_v2", { ...args, p_op: op });
      if (!lacksOpSupport(res.error)) return res;
      opsSupported = false;
    }
    return sb.rpc("save_progress_v2", args);
  }
  // The server now holds a save this device sent: it becomes the base for the next diff and merge.
  function markSaved(args, result) {
    for (const [name, value] of Object.entries(args.p_sections || {})) savedSections.set(name, stableJson(value));
    for (const [name, rev] of Object.entries(result?.revs || {})) savedRevs.set(name, Number(rev));
    for (const [key, stats] of Object.entries(args.p_mastery || {})) savedMasteryJson.set(key, stableJson(stats));
    for (const key of args.p_mastery_removes || []) savedMasteryJson.delete(key);
    if (args.p_profile) savedProfile = stableJson(args.p_profile);
  }
  // Send the unanswered save again (same id). Applied now, or already applied: it is on the server.
  // Refused for a stale revision: it never was, and the normal merge deals with it.
  async function resolveInflight() {
    if (!inflight) return;
    const { op, args } = inflight;
    const { data: result, error } = await callSave(args, op);
    if (error) { if (wasNotApplied(error)) inflight = null; throw error; }
    if (!result?.conflict) markSaved(args, result);
    inflight = null;
  }
  async function resolveSnapshotInflight(snapshot) {
    const { op, args } = snapshot.inflight;
    const { data: result, error } = await callSave(args, op);
    if (error) throw error;
    inflight = null;
    const { inflight: _gone, ...rest } = snapshot;
    return result?.conflict ? rest : { ...rest, base: baseAfter(snapshot.base, args, result?.revs) };
  }

  async function loadProgress() {
    let snapshot = await idb.get(snapshotKey);
    if (snapshot?.inflight) {
      // The last save of the previous page may or may not have reached the database. Ask about it first:
      // if it did, it is part of the server's copy and must not be merged in again.
      try { snapshot = await resolveSnapshotInflight(snapshot); } catch (e) {
        if (snapshot.data) { inflight = snapshot.inflight; status.set("offline"); lastLocal = snapshot.data; return snapshot.data; }
        throw e;
      }
    }
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
    reportsSync.rememberRemote(remote);
    const hasServer = hasServerRows(sections, masteryRows);
    // Play from this device that never reached the server: merge it with
    // whatever other devices saved meanwhile; the next save sends it.
    if (snapshot?.dirty && snapshot.data) {
      const merged = mergeUnsynced(snapshot, serverSections, mastery, savedRevs);
      merged.reports = [...reportsSync.reconcile((merged.reports || []).filter((r) => !r?._remote), sectionReports, ownReportRows), ...remote];
      lastLocal = merged;
      return merged;
    }
    if (data.reports) data.reports = reportsSync.reconcile(data.reports, sectionReports, ownReportRows);
    if (remote.length) data.reports = [...(data.reports || []), ...remote];
    const out = hasServer || remote.length ? data : null;
    lastLocal = out;
    return out;
  }

  // Sends what changed. When another device wrote one of the sections
  // first, merges with its copy and tries again. Returns the data actually
  // saved (merged, if it had to be).
  async function pushProgress(input, replace = false) {
    let data = input;
    await resolveInflight();
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
      const reportsChanged = reportsSync.changed(own, remote);
      if (!Object.keys(changedSections).length && !Object.keys(upserts).length && !removes.length && profileJson === savedProfile && !reportsChanged) return data;
      // Reports go first: the progress that lists a report is never on the
      // server before the report itself (see reconcileReports).
      if (reportsChanged) await reportsSync.sync(own, remote);
      const expected = Object.fromEntries(Object.keys(changedSections).map((name) => [name, savedRevs.get(name) ?? null]));
      const args = { p_sections: changedSections, p_expected: expected, p_mastery: upserts, p_mastery_removes: removes, p_profile: profile, p_replace: !!replace };
      // Written down before it is sent: if the answer is lost, or the page closes, the next try is this same save.
      if (opsSupported) { inflight = inflightOf(newOpId(), args); await writeSnapshot(dirtySnapshot(lastLocal || data, localRev)); }
      const { data: result, error } = await callSave(args, inflight?.op);
      if (error) { if (wasNotApplied(error)) inflight = null; throw error; }
      if (result?.conflict) {
        inflight = null;
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
      inflight = null;
      markSaved(args, result);
      savedMasteryRefs = new Map(Object.entries(data.mastery || {}));
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
  const dirtySnapshot = (data, rev) => ({ data, dirty: true, rev, at: Date.now(), base: baseForSnapshot(), ...(inflight ? { inflight } : {}) });
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
          await writeSnapshot(dirtySnapshot(latest.data, latest.rev));
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
    loadContent: content.load,
    saveContent: content.save,
    loadProgress,
    // replace: a restored backup; it overwrites instead of merging.
    async saveProgress(data, { replace = false } = {}) {
      const rev = ++localRev;
      lastLocal = data;
      latest = { data, rev, replace: replace || !!latest?.replace };
      await writeSnapshot(dirtySnapshot(data, rev));
      return flush();
    },
    refreshProgress,
    onMerged(fn) { mergedSubs.add(fn); return () => mergedSubs.delete(fn); },
    async resetProgress() {
      latest = null; localRev++; inflight = null;
      if (running) await running.catch(() => {});
      const { error } = await sb.rpc("reset_my_progress");
      if (error) throw error;
      savedSections = new Map(); savedRevs = new Map(); savedMasteryJson = new Map(); savedMasteryRefs = new Map(); savedProfile = ""; lastLocal = null;
      await (idbQueue = idbQueue.then(() => idb.del(snapshotKey)));
    },
    async wipeContent() { await content.save(emptyContent()); },
    dispose() { if (typeof window !== "undefined") window.removeEventListener("online", onOnline); clearTimeout(retryTimer); },
  };
}

// Exposed for tests.
export { createLocalRepo } from "./repo/localRepo";

export const _internals = { splitSections, weekStart, masteryDiff };

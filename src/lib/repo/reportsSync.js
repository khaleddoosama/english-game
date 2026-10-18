// The player's reports, kept in step with the reports table. The store owns
// the state that belongs only to reports: what the table is known to hold for
// this player (own) and, for the admin, for everyone else (remote). Created
// once for each repo. The decisions (what to merge, what to send) are in
// reportsMerge.js; this file remembers and talks to the server.
import { stableJson } from "../stableJson";
import { reconcileReports } from "./reportsMerge";

export function createReportsSync({ sb, isAdmin }) {
  let savedReports = new Map();             // id -> json (own reports, as in the reports table)
  let savedRemoteReports = new Map();       // id -> json (other players', admin only)

  // The player's own reports against the reports table (what the table holds is remembered here).
  function reconcile(local, sectionReports, rows) {
    const { reports, saved } = reconcileReports({ local, sectionReports, rows, isAdmin });
    for (const [id, json] of saved) savedReports.set(id, json);
    return reports;
  }

  // Other players' reports, as read (the admin's view).
  function rememberRemote(remote) {
    for (const r of remote) savedRemoteReports.set(r.id, stableJson(r));
  }

  // Is there anything to send?
  function changed(own, remote) {
    return own.some((r) => r?.id && savedReports.get(r.id) !== stableJson(r)) || own.filter((r) => r?.id).length !== savedReports.size
      || (isAdmin && (remote.length !== savedRemoteReports.size || remote.some((r) => savedRemoteReports.get(r.id) !== stableJson(r))));
  }

  async function sync(own, remote) {
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

  return { reconcile, rememberRemote, changed, sync };
}

// The player's own reports, reconciled with the reports table. Pure: it does
// not remember anything; `saved` lists the [id, json] pairs the caller must
// record as "what the server has".
import { stableJson } from "../stableJson";

// The player's own reports: the reports table has the admin's decisions
// (resolved, deleted, notes added); this device has what it changed since
// its last save. A report the server's progress lists but the table
// doesn't have was deleted; one only this device has wasn't sent yet.
// Reports filed on another device arrive with that device's progress.
export function reconcileReports({ local, sectionReports, rows, isAdmin }) {
  const table = new Map(rows.map((row) => [row.id, row]));
  const sent = new Map(sectionReports.filter((r) => r?.id).map((r) => [r.id, stableJson(r)]));
  const out = [], saved = [];
  for (const r of local) {
    if (!r?.id) { out.push(r); continue; }
    const row = table.get(r.id);
    if (!row) { if (!sent.has(r.id)) out.push(r); continue; }
    const resolvedAt = row.resolved_at ? Date.parse(row.resolved_at) : null;
    const fromTable = { ...row.data, resolvedAt };
    saved.push([r.id, stableJson(fromTable)]);
    const changedHere = sent.has(r.id) && sent.get(r.id) !== stableJson(r);
    out.push(!changedHere ? fromTable : isAdmin ? r : { ...r, resolvedAt });
  }
  return { reports: out, saved };
}

import { normalizeTerm } from '../../../api/_lib/vocabulary.js';

export function parseBulkWords(input) {
  const seen = new Set(), items = [];
  for (const raw of String(input).split(/[,،\n\r]+/).map(s => s.trim()).filter(Boolean)) {
    let term, error;
    try { term = normalizeTerm(raw); } catch (e) { term = raw; error = e.message; }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); items.push({ term, status: error ? 'failed' : 'pending', error });
  }
  if (!items.length) throw new Error('Enter at least one word or phrase.');
  if (items.length > 100) throw new Error('Add up to 100 words per batch.');
  return items;
}

export function groupContent(item, category, units) {
  const next = { ...item };
  if (category.trim()) { next.category = category.trim(); delete next.categoryId; }
  const names = String(units).split(/[,،\n]+/).map(s => s.trim()).filter(Boolean);
  if (names.length) next.units = [...new Set([...(item.units || []), ...names])];
  return next;
}

// Successful rows are never regenerated on retry. An assignment failure keeps
// the obtained entry, so the next attempt only retries saving its grouping.
export async function runBulkWords(items, { add, save, category = '', units = '', existing = [], onUpdate }) {
  const rows = items.map(item => ({ ...item }));
  const own = new Map(existing.map(w => [w.word.toLowerCase(), w]));
  const order = rows.map((_,i)=>i).sort((a,b)=>Number(!!(rows[b].entry || own.has(rows[b].term.toLowerCase())))-Number(!!(rows[a].entry || own.has(rows[a].term.toLowerCase()))));
  for (const i of order) {
    if (rows[i].status === 'done') continue;
    try { normalizeTerm(rows[i].term); } catch (e) { rows[i] = { ...rows[i], status: 'failed', error: e.message }; onUpdate([...rows]); continue; }
    rows[i] = { ...rows[i], status: 'working', error: null }; onUpdate([...rows]);
    try {
      const entry = rows[i].entry || own.get(rows[i].term.toLowerCase()) || (await add(rows[i].term)).word;
      rows[i].entry = entry;
      if (category.trim() || units.trim()) await save(groupContent(entry, category, units));
      own.set(entry.word.toLowerCase(), entry);
      rows[i] = { ...rows[i], status: 'done', error: null };
    } catch (e) { rows[i] = { ...rows[i], status: 'failed', error: e.message }; }
    onUpdate([...rows]);
  }
  return rows;
}

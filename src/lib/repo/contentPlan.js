// Content as the repo holds and saves it: the empty shape, the player's copy
// from the cache, and what a save must send. Pure.
import { stableJson } from "../stableJson";

export const CONTENT_KINDS = ["words", "grammar", "challenges", "stories", "combos"];
export const POSITION_GAP = 1000;
const keyOf = (kind, item) => (kind === "words" ? item?.word : item?.id);

export const emptyContent = () => ({ words: [], grammar: [], challenges: [], stories: [], combos: [], levelOrder: [], note: "" });
export const hasContent = (c) => !!c && CONTENT_KINDS.some((k) => (c[k] || []).length);

// The content a cache holds, in its stored order.
export function contentFromCache(cache) {
  const out = emptyContent();
  const rows = Object.values(cache.items).sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : 1));
  for (const row of rows) out[row.kind].push(row.data);
  out.levelOrder = cache.levelOrder || [];
  out.note = cache.note || "";
  return out;
}

// What saving `content` would send, given what the server is known to hold:
// contentRows (`${kind}\u0000${key}` -> { kind, key, json, position }) and
// contentMeta ({ levelOrder, note } as JSON text). Items keep their order with
// gaps between positions, so deleting or appending never renumbers the rest.
export function planContentSave(content, contentRows, contentMeta) {
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
  return { upserts, removes, levelOrder, note, metaChanged };
}

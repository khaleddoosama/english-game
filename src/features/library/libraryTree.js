// Pure helpers for the library screen: the tree of views, finding words in
// the dictionary, and matching a pasted list of words.
import { V2 } from "../../engine/v2";

// The flat list from view_tree() -> nested { ...view, depth, children }.
export function buildTree(flat) {
  const nodes = new Map((flat || []).map((v) => [v.id, { ...v, depth: 0, children: [] }]));
  const roots = [];
  for (const n of nodes.values()) {
    const parent = n.parent && nodes.get(n.parent);
    (parent ? parent.children : roots).push(n);
  }
  const sort = (list, depth) => {
    list.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name));
    for (const n of list) { n.depth = depth; sort(n.children, depth + 1); }
  };
  sort(roots, 0);
  return roots;
}

// Depth-first list, for drawing the tree as indented rows.
export function flattenTree(roots) {
  const out = [];
  const walk = (list) => { for (const n of list) { out.push(n); walk(n.children); } };
  walk(roots);
  return out;
}

// Views a view can be moved into: not itself, not anything inside it, and not
// so deep that what is inside it would pass 4 levels.
export function moveTargets(roots, id, maxDepth = 4) {
  const all = flattenTree(roots);
  const me = all.find((n) => n.id === id);
  if (!me) return [];
  const height = (n) => (n.children.length ? 1 + Math.max(...n.children.map(height)) : 0);
  const blocked = new Set(flattenTree([me]).map((n) => n.id));
  return all.filter((n) => !blocked.has(n.id) && n.depth + 1 + height(me) + 1 <= maxDepth);
}

// Words whose text, meaning or category contains the query. Several senses of
// one word each show up with their own meaning.
export function searchWords(words, query, limit = 40) {
  const q = V2.norm(query);
  if (!q) return [];
  const starts = [], inside = [];
  for (const w of words || []) {
    const name = V2.norm(w.word);
    if (name.startsWith(q) || V2.norm(V2.headword(w)).startsWith(q)) starts.push(w);
    else if (name.includes(q) || V2.norm(w.meaning || "").includes(q)) inside.push(w);
    if (starts.length >= limit) break;
  }
  return [...starts, ...inside].slice(0, limit);
}

// A pasted list (one word per line, or separated by commas) against the
// dictionary. A line that names exactly one entry matches it; a word with
// several meanings is "ambiguous" and the player picks; the rest is missing.
export function matchPasted(text, words) {
  // A word written twice ("Cast", "cast") is one token: the first spelling stays.
  const first = new Map();
  for (const t of String(text || "").split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean)) if (!first.has(V2.norm(t))) first.set(V2.norm(t), t);
  const tokens = [...first.values()];
  const matched = [], ambiguous = [], missing = [];
  for (const token of tokens) {
    const exact = (words || []).find((w) => V2.norm(w.word) === V2.norm(token));
    const family = (words || []).filter((w) => V2.norm(V2.headword(w)) === V2.norm(token));
    if (exact && (family.length <= 1 || V2.norm(exact.word) === V2.norm(token))) {
      // "Cast" typed exactly is the plain entry; ambiguity only when there are other meanings too.
      if (family.length > 1) ambiguous.push({ token, options: family.map((w) => w.word) });
      else matched.push(exact.word);
    } else if (family.length === 1) matched.push(family[0].word);
    else if (family.length > 1) ambiguous.push({ token, options: family.map((w) => w.word) });
    else missing.push(token);
  }
  return { matched: [...new Set(matched)], ambiguous, missing };
}

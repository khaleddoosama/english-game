// The import graph of src/, for tests that guard the shape of the code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const SRC = resolve(import.meta.dirname, "../src");

export const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|css)$/.test(p) ? [p] : [];
});

// The relative specifiers a file imports (static, dynamic, side-effect).
export const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g)].map((m) => m[1]);

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
// "x" -> x.js / x.jsx / x/index.js ... (CSS and files with an extension are as written)
export function resolveImport(file, spec) {
  const base = resolve(dirname(file), spec);
  return [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`, `${base}/index.jsx`].find(isFile) || null;
}
export const key = (p) => relative(SRC, p).replace(/\.(jsx?|css)$/, "");

// { "features/library/index": ["features/library/useLibrary", ...] } for every source file
export function fileGraph() {
  const graph = {};
  for (const f of walk(SRC)) {
    graph[key(f)] = [...new Set(importsOf(f).map((s) => resolveImport(f, s)).filter(Boolean).map(key))];
  }
  return graph;
}

// "features/library/index" -> "features/library"; "lib/repo" -> "lib"; "app/App" -> "app"
export const moduleOf = (k) => { const p = k.split("/"); return p[0] === "features" ? `features/${p[1]}` : p[0]; };

// Groups of two or more nodes that import each other in a loop (Tarjan).
export function cycles(edges) {
  let n = 0;
  const stack = [], on = new Set(), index = new Map(), low = new Map(), out = [];
  const visit = (v) => {
    index.set(v, n); low.set(v, n++); stack.push(v); on.add(v);
    for (const w of edges[v] || []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const group = []; let w;
      do { w = stack.pop(); on.delete(w); group.push(w); } while (w !== v);
      if (group.length > 1) out.push(group.sort());
    }
  };
  for (const v of Object.keys(edges)) if (!index.has(v)) visit(v);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// The graph between modules: { "app": Set(["features/library", ...]) }
export function moduleGraph(graph = fileGraph()) {
  const edges = {};
  for (const [from, tos] of Object.entries(graph)) {
    for (const to of tos) if (moduleOf(from) !== moduleOf(to)) (edges[moduleOf(from)] ||= new Set()).add(moduleOf(to));
    edges[moduleOf(from)] ||= new Set();
  }
  return Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, [...v].sort()]));
}

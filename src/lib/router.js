// A small router on top of the History API. Every page has its own path
// (/admin/words, /live/AB12CD, /stats…) and list filters live in the query
// string (/admin/words?hasPicture=true&page=2), so a refresh or a shared
// link opens the same page with the same filters. Vercel and the service
// worker send every unknown path to index.html.
import { useCallback, useSyncExternalStore } from "react";

const hasWindow = typeof window !== "undefined";
const listeners = new Set();
let snapshot = read();

function read() {
  if (!hasWindow) return { path: "/", search: "", href: "/" };
  const { pathname, search } = window.location;
  return { path: pathname || "/", search, href: pathname + search };
}
function emit() {
  const next = read();
  if (next.href === snapshot.href) return;
  snapshot = next;
  listeners.forEach((l) => l());
}
if (hasWindow) window.addEventListener("popstate", emit);

function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
const getSnapshot = () => snapshot;

export function navigate(to, { replace = false } = {}) {
  if (!hasWindow) return;
  const url = new URL(to, window.location.href);
  const href = url.pathname + url.search + url.hash;
  if (href === window.location.pathname + window.location.search + window.location.hash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", href);
  emit();
}

export function useLocation() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ---------------------------------------------------- pure helpers */

// Turns { page: 2, q: "", hasPicture: true } into a query string, dropping
// empty values and values equal to their defaults.
export function mergeQuery(search, patch, defaults = {}) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    const isDefault = key in defaults && String(value) === String(defaults[key]);
    if (value == null || value === "" || isDefault) params.delete(key);
    else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function readQuery(search) {
  return Object.fromEntries(new URLSearchParams(search));
}

const seg = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// Path -> route. Unknown paths come back as { screen: "notFound" }.
export function parseRoute(path) {
  const parts = String(path || "/").split("/").filter(Boolean).map(seg);
  const [head, a, b] = parts;
  if (!head) return { screen: "levels", section: "practice" };
  switch (head) {
    case "practice": return { screen: "levels", section: "legacy" };
    case "review": return { screen: "review" };
    case "stories": return { screen: "levels", section: "stories" };
    case "play": return { screen: "play" };
    case "live": return { screen: "live", code: a ? a.toUpperCase() : null };
    case "leaderboard": return { screen: "leaderboard" };
    case "profile": return { screen: "profile" };
    case "account": return { screen: "account" };
    case "onboarding": return { screen: "onboarding" };
    case "hearts": return { screen: "hearts" };
    case "stats": return { screen: "stats" };
    case "badges": return { screen: "badges" };
    case "data": return { screen: "data" };
    case "settings": return { screen: "settings" };
    case "admin": return { screen: "admin", section: a || "overview", item: b ?? null };
    default: return { screen: "notFound" };
  }
}

// Screen (and a few extras) -> path.
export function pathFor(screen, extra = {}) {
  const enc = encodeURIComponent;
  switch (screen) {
    case "levels": return extra.section === "stories" ? "/stories" : extra.section === "legacy" ? "/practice" : "/";
    case "live": return extra.code ? `/live/${enc(extra.code)}` : "/live";
    case "admin": return `/admin${extra.section && extra.section !== "overview" ? `/${enc(extra.section)}` : ""}${extra.item != null ? `/${enc(extra.item)}` : ""}`;
    case "review": case "leaderboard": case "profile": case "account": case "onboarding": case "hearts": case "stats": case "badges": case "data": case "settings": return `/${screen}`;
    default: return "/play";
  }
}

/* ------------------------------------------------------------ hooks */

// Query-string state: [values, set(patch, { replace })]. Filters replace the
// history entry by default so Back leaves the page instead of undoing each
// keystroke of a search.
export function useQuery(defaults = {}) {
  const loc = useLocation();
  const values = { ...defaults, ...readQuery(loc.search) };
  const set = useCallback((patch, { replace = true } = {}) => {
    if (!hasWindow) return;
    navigate(window.location.pathname + mergeQuery(window.location.search, patch, defaults), { replace });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaults)]);
  return [values, set];
}

// One query parameter as state.
export function useQueryParam(name, fallback = "") {
  const [values, set] = useQuery({ [name]: fallback });
  const value = values[name] ?? fallback;
  const setValue = useCallback((v, opts) => set({ [name]: v }, opts), [set, name]);
  return [value, setValue];
}

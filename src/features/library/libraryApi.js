// The personal library and its views (folders inside folders). Online:
// Supabase functions (migration 0026) do every check. Local mode (no
// Supabase): the same interface over localStorage, mirroring the server's
// rules and messages, so the tests can run it and two tabs can try it.
import { isLocalMode, supabase } from "../../lib/supabase";

export class LibraryError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const friendly = (error) => {
  const msg = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new LibraryError("You're offline. The library needs a connection.", "offline");
  return new LibraryError(msg, error?.code);
};

export const MAX_VIEWS = 200;
export const MAX_DEPTH = 4;
export const MAX_PER_CALL = 200;
export const MAX_SHARE_USERS = 20;
export const MAX_SHARES_WAITING = 50;
export const MAX_LIBRARY = 5000;
export const NAME_ERROR = 'A view name is 1 to 60 characters and has no "::" in it.';
export const cleanViewName = (s) => String(s ?? "").trim();
export const validViewName = (s) => { const n = cleanViewName(s); return n.length >= 1 && n.length <= 60 && !n.includes("::"); };

// A card in the game's shape ({ word, type, partsOfSpeech, category, meaning,
// situation, gap, hints … }) as the arguments of sense_create: the columns the
// database keeps apart, and everything else as the card's content.
export function senseFromCard(card, source = "user") {
  const { word, type, partsOfSpeech, category, meaning, level, ...content } = card || {};
  const clean = Object.fromEntries(Object.entries(content).filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null && v !== ""));
  return { word: String(word || "").trim(), type: type || "vocab", pos: Array.isArray(partsOfSpeech) ? partsOfSpeech : [], category: category || null, meaning: String(meaning || "").trim(), content: clean, source: card?._aiAdded ? "ai" : source };
}

/* ------------------------------------------------------------ online */

function supabaseApi(client) {
  const rpc = async (fn, args) => {
    let data, error;
    try { ({ data, error } = await client.rpc(fn, args)); } catch (e) { throw friendly(e); }
    if (error) throw friendly(error);
    return data;
  };
  return {
    mode: "online",
    tree: () => rpc("view_tree"),
    create: (name, parent = null, source = null) => rpc("view_create", { p_name: name, p_parent: parent, p_source: source }),
    rename: (id, name) => rpc("view_edit", { p_id: id, p_name: name }),
    move: (id, parent = null) => rpc("view_edit", { p_id: id, p_move: true, p_parent: parent }),
    remove: (id) => rpc("view_remove", { p_id: id }),
    add: (view, senseIds) => rpc("view_add", { p_view: view, p_senses: senseIds }),
    drop: (view, senseId) => rpc("view_drop", { p_view: view, p_sense: senseId }),
    addRules: (view, ruleIds) => rpc("view_add_rules", { p_view: view, p_rules: ruleIds }),
    contents: (view, deep = true) => rpc("view_contents", { p_view: view, p_deep: deep }),
    libraryAdd: (senseIds) => rpc("library_add", { p_senses: senseIds }),
    libraryRemove: (senseId) => rpc("library_remove", { p_sense: senseId }),
    patch: (senseId, patch, note = null) => rpc("library_patch", { p_sense: senseId, p_patch: patch, p_note: note }),
    createWord: (card) => { const w = senseFromCard(card); return rpc("sense_create", { p_word: w.word, p_type: w.type, p_pos: w.pos, p_category: w.category, p_meaning: w.meaning, p_content: w.content, p_source: w.source }); },
    share: (view, userIds) => rpc("view_share", { p_view: view, p_users: userIds }),
    inbox: () => rpc("view_shares_inbox"),
    accept: (shareId) => rpc("view_share_accept", { p_share: shareId }),
    dismiss: (shareId) => rpc("view_share_dismiss", { p_share: shareId }),
  };
}

/* ------------------------------------------------------------- local */

// storage: anything with getItem/setItem (tests pass a Map-backed fake).
// me(): the current player's id. canSee(senseId): whether that word exists
// and may be added (the dictionary lives elsewhere in local mode).
export function createLocalLibraryApi({ storage, me, canSee = () => true, areFriends = () => false, nameOf = () => "player", now = () => Date.now() }) {
  const empty = () => ({ views: [], entries: {}, seq: 0 });
  const load = (user = me()) => { try { return JSON.parse(storage.getItem(`library1:${user}`) || "null") || empty(); } catch { return empty(); } };
  const save = (db, user = me()) => storage.setItem(`library1:${user}`, JSON.stringify(db));
  const sharesKey = "library1:shares";
  const loadShares = () => { try { return JSON.parse(storage.getItem(sharesKey) || "null") || []; } catch { return []; } };
  const fail = (message, code) => { throw new LibraryError(message, code); };
  const live = (db) => db.views.filter((v) => !v.removed);
  const byId = (db, id) => live(db).find((v) => v.id === id);
  const depth = (db, id) => { let d = 0; for (let v = byId(db, id); v; v = v.parent && byId(db, v.parent)) d++; return d; };
  const kids = (db, id) => live(db).filter((v) => v.parent === id);
  const inside = (db, id) => kids(db, id).flatMap((v) => [v.id, ...inside(db, v.id)]);
  const pathOf = (db, parent, name) => (parent ? `${byId(db, parent).path}::${name}` : name);
  const sameName = (db, parent, name, except) => live(db).some((v) => v.id !== except && (v.parent || null) === (parent || null) && v.name.toLowerCase() === name.toLowerCase());
  const active = (items) => Object.entries(items).filter(([, e]) => !e.removed).map(([id]) => id);

  return {
    mode: "local",
    async tree() {
      const db = load();
      return live(db).map((v) => ({ id: v.id, parent: v.parent || null, name: v.name, path: v.path, position: v.position, source: v.source || null, words: active(v.senses || {}).length, rules: active(v.rules || {}).length })).sort((a, b) => (a.path < b.path ? -1 : 1));
    },
    async create(name, parent = null, source = null) {
      const db = load(), n = cleanViewName(name);
      if (!validViewName(n)) fail(NAME_ERROR, "22023");
      if (live(db).length >= MAX_VIEWS) fail(`You have ${MAX_VIEWS} views, the most there can be.`, "55000");
      if (parent) {
        if (!byId(db, parent)) fail("That view does not exist.", "P0002");
        if (depth(db, parent) >= MAX_DEPTH) fail(`Views can be ${MAX_DEPTH} levels deep, no more.`, "55000");
      }
      if (sameName(db, parent, n)) fail(`There is already a view called "${n}" here.`, "23505");
      const id = `v${++db.seq}-${now()}`;
      db.views.push({ id, parent: parent || null, source: source || null, name: n, path: pathOf(db, parent, n), position: live(db).filter((v) => (v.parent || null) === (parent || null)).length + 1, senses: {}, rules: {} });
      save(db);
      return id;
    },
    async edit(id, { name, move = false, parent = null } = {}) {
      const db = load(), v = byId(db, id);
      if (!v) fail("That view does not exist.", "P0002");
      const n = cleanViewName(name) || v.name;
      const to = move ? parent : v.parent;
      if (!validViewName(n)) fail(NAME_ERROR, "22023");
      if (to) {
        if (!byId(db, to)) fail("That view does not exist.", "P0002");
        if (to === id || inside(db, id).includes(to)) fail("A view cannot go inside itself.", "22023");
        const h = (function h(x) { const c = kids(db, x); return c.length ? 1 + Math.max(...c.map((k) => h(k.id))) : 0; })(id);
        if (depth(db, to) + h + 1 > MAX_DEPTH) fail(`Views can be ${MAX_DEPTH} levels deep, no more.`, "55000");
      }
      if (sameName(db, to, n, id)) fail(`There is already a view called "${n}" here.`, "23505");
      const oldPath = v.path;
      v.name = n; v.parent = to || null; v.path = pathOf(db, to, n);
      for (const c of live(db)) if (c.id !== id && c.path.startsWith(`${oldPath}::`)) c.path = v.path + c.path.slice(oldPath.length);
      save(db);
    },
    rename(id, name) { return this.edit(id, { name }); },
    move(id, parent = null) { return this.edit(id, { move: true, parent }); },
    async remove(id) {
      const db = load(), v = byId(db, id);
      if (!v) return;
      for (const x of [id, ...inside(db, id)]) byId(db, x).removed = true;
      save(db);
    },
    async libraryAdd(senseIds) {
      const db = load();
      if (senseIds.length > MAX_PER_CALL) fail(`Add up to ${MAX_PER_CALL} words at a time.`, "22023");
      if (active(db.entries).length + senseIds.length > MAX_LIBRARY) fail(`A library holds up to ${MAX_LIBRARY} words.`, "55000");
      const ok = senseIds.filter((s) => canSee(s));
      for (const s of ok) db.entries[s] = { patch: db.entries[s]?.patch || {}, note: db.entries[s]?.note || null };
      save(db);
      return ok;
    },
    // The word itself lives in the game's own content in local mode; here it only joins the library.
    async createWord(card) {
      const word = senseFromCard(card).word;
      if (!word) fail("A word is 1 to 120 characters.", "22023");
      const known = Boolean(load().entries[word] && !load().entries[word].removed);
      await this.libraryAdd([word]);
      return { id: word, existing: known };
    },
    async libraryRemove(senseId) {
      const db = load();
      if (db.entries[senseId]) db.entries[senseId].removed = true;
      for (const v of live(db)) if (v.senses[senseId]) v.senses[senseId].removed = true;
      save(db);
    },
    async patch(senseId, patch, note = null) {
      const db = load(), e = db.entries[senseId];
      if (patch == null || typeof patch !== "object" || Array.isArray(patch)) fail("A patch is an object.", "22023");
      if (JSON.stringify(patch).length > 7000) fail("That change is too big.", "22023");
      if (!e || e.removed) fail("That word is not in your library.", "P0002");
      e.patch = patch; e.note = String(note ?? "").trim() || null;
      save(db);
    },
    async add(view, senseIds) {
      let db = load();
      if (!byId(db, view)) fail("That view does not exist.", "P0002");
      if (senseIds.length > MAX_PER_CALL) fail(`Add up to ${MAX_PER_CALL} words at a time.`, "22023");
      await this.libraryAdd(senseIds);
      db = load();
      const v = byId(db, view);
      let n = 0;
      for (const s of senseIds) {
        if (!db.entries[s] || db.entries[s].removed) continue;
        if (v.senses[s] && !v.senses[s].removed) continue;
        v.senses[s] = { at: now() }; n++;
      }
      save(db);
      return n;
    },
    async drop(view, senseId) {
      const db = load(), v = byId(db, view);
      if (v?.senses[senseId]) { v.senses[senseId].removed = true; save(db); }
    },
    async addRules(view, ruleIds) {
      const db = load(), v = byId(db, view);
      if (!v) fail("That view does not exist.", "P0002");
      if (ruleIds.length > MAX_PER_CALL) fail(`Add up to ${MAX_PER_CALL} rules at a time.`, "22023");
      let n = 0;
      for (const r of ruleIds) if (!v.rules[r] || v.rules[r].removed) { v.rules[r] = { at: now() }; n++; }
      save(db);
      return n;
    },
    // ---- sharing: the offer lives apart from both libraries; accepting copies
    async share(view, userIds) {
      const db = load();
      if (!byId(db, view)) fail("That view does not exist.", "P0002");
      const to = [...new Set(userIds || [])];
      if (to.length > MAX_SHARE_USERS) fail(`Share with up to ${MAX_SHARE_USERS} friends at a time.`, "22023");
      const shares = loadShares();
      let sent = 0;
      for (const u of to) {
        if (u === me()) continue;
        if (!areFriends(me(), u)) fail("You can share only with your friends.", "42501");
        if (shares.filter((x) => x.to === u && x.status === "pending").length >= MAX_SHARES_WAITING) fail("A friend has too many shares waiting. Try again later.", "55000");
        if (shares.some((x) => x.view === view && x.from === me() && x.to === u && x.status === "pending")) continue;
        shares.push({ id: `s${shares.length + 1}-${now()}`, view, from: me(), to: u, status: "pending", at: now() });
        sent++;
      }
      storage.setItem(sharesKey, JSON.stringify(shares));
      return sent;
    },
    async inbox() {
      return loadShares().filter((x) => x.to === me() && x.status === "pending").flatMap((x) => {
        const theirs = load(x.from), v = byId(theirs, x.view);
        if (!v || !areFriends(me(), x.from)) return [];
        const below = live(theirs).filter((d) => d.path.startsWith(`${v.path}::`));
        return [{ id: x.id, name: v.name, from: nameOf(x.from), from_id: x.from, at: new Date(x.at).toISOString(), words: active(v.senses).length, rules: active(v.rules).length, views: below.length + 1 }];
      }).sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    async accept(shareId) {
      const shares = loadShares(), sh = shares.find((x) => x.id === shareId && x.to === me());
      if (!sh || sh.status !== "pending") fail("That share is no longer waiting.", "P0002");
      const theirs = load(sh.from), src = byId(theirs, sh.view);
      if (!src) fail("The sender removed that view.", "P0002");
      if (!areFriends(me(), sh.from)) fail("You are no longer friends.", "42501");
      const mine = load();
      const tree = [src, ...live(theirs).filter((d) => d.path.startsWith(`${src.path}::`))];
      if (live(mine).length + tree.length > MAX_VIEWS) fail(`You do not have room for ${tree.length} more views (the most is ${MAX_VIEWS}).`, "55000");
      const base = `${src.name.slice(0, 30)} (from ${nameOf(sh.from).slice(0, 15)})`;
      let name = base, n = 1;
      while (sameName(mine, null, name)) name = `${base} ${++n}`;
      const ids = new Map(tree.map((v) => [v.id, `v${++mine.seq}-${now()}`]));
      let words = 0, rules = 0;
      for (const v of tree) {
        const copy = { id: ids.get(v.id), parent: v.id === src.id ? null : ids.get(v.parent) || null, source: null, name: v.id === src.id ? name : v.name, path: v.id === src.id ? name : null, position: v.position, senses: {}, rules: {} };
        for (const k of active(v.senses)) { if (!canSee(k)) continue; copy.senses[k] = { at: now() }; mine.entries[k] = { patch: mine.entries[k]?.patch || {}, note: mine.entries[k]?.note || null }; words++; }
        for (const k of active(v.rules)) { copy.rules[k] = { at: now() }; rules++; }
        mine.views.push(copy);
      }
      // paths follow the parents, top down
      const fix = (v) => { for (const c of mine.views.filter((x) => x.parent === v.id)) { c.path = `${v.path}::${c.name}`; fix(c); } };
      fix(mine.views.find((v) => v.id === ids.get(src.id)));
      save(mine);
      sh.status = "accepted"; sh.copy = ids.get(src.id);
      storage.setItem(sharesKey, JSON.stringify(shares));
      return { view: ids.get(src.id), name, views: tree.length, words, rules, skipped: 0 };
    },
    async dismiss(shareId) {
      const shares = loadShares(), sh = shares.find((x) => x.id === shareId && x.to === me() && x.status === "pending");
      if (sh) { sh.status = "dismissed"; storage.setItem(sharesKey, JSON.stringify(shares)); }
    },
    async contents(view, deep = true) {
      const db = load();
      if (!byId(db, view)) return [];
      const ids = [view, ...(deep ? inside(db, view) : [])];
      const out = new Map();
      for (const id of ids) {
        const v = byId(db, id);
        for (const s of active(v.senses)) out.set(`sense:${s}`, { kind: "sense", id: s });
        for (const r of active(v.rules)) out.set(`rule:${r}`, { kind: "rule", id: r });
      }
      return [...out.values()];
    },
  };
}

// Online: the Supabase functions. Local mode: the localStorage mirror, which
// the app wires up with { storage, me, canSee }.
let shared = null;
export function getLibraryApi(local) {
  if (isLocalMode) return createLocalLibraryApi(local || { storage: globalThis.localStorage, me: () => "local" });
  return (shared ||= supabaseApi(supabase));
}
export { supabaseApi as createSupabaseLibraryApi };

// The library itself (which words a player has, and their own wording of
// them), and adding words to a view, which adds them to the library first.
import { MAX_LIBRARY, MAX_PER_CALL, MAX_WORD, MSG, senseFromCard } from "../libraryRules";
import { activeKeys, findView, liveViews } from "./localViews";

export function createLocalWordsApi(ctx) {
  const { load, save, fail, canSee, now } = ctx;
  const libraryAdd = async (senseIds) => {
    const db = load();
    if (senseIds.length > MAX_PER_CALL) fail(MSG.tooManyWords);
    if (activeKeys(db.entries).length + senseIds.length > MAX_LIBRARY) fail(MSG.libraryFull);
    const ok = senseIds.filter((s) => canSee(s));
    for (const s of ok) db.entries[s] = { patch: db.entries[s]?.patch || {}, note: db.entries[s]?.note || null, at: db.entries[s] && !db.entries[s].removed ? db.entries[s].at : now() };
    save(db);
    return ok;
  };
  return {
    libraryAdd,
    // Everything in my library, newest first, with how many of my views each word is in.
    async libraryList() {
      const db = load();
      const words = Object.entries(db.entries).filter(([, e]) => !e.removed)
        .map(([id, e]) => ({ id, note: e.note || null, patch: e.patch || {}, added_at: new Date(e.at || 0).toISOString(), views: liveViews(db).filter((v) => v.senses[id] && !v.senses[id].removed).length }));
      const rules = [...new Set([...Object.entries(db.rules || {}).filter(([, e]) => !e.removed).map(([id]) => id), ...liveViews(db).flatMap((v) => activeKeys(v.rules))])].map((id) => ({ id, added_at: null }));
      return { words, rules };
    },
    // Grammar rules in my library (a rule in a view is in my library too).
    async libraryAddRules(ruleIds) {
      if (ruleIds.length > MAX_PER_CALL) fail(MSG.tooManyRules);
      const db = load(); db.rules ||= {};
      const had = new Set([...Object.entries(db.rules).filter(([, e]) => !e.removed).map(([id]) => id), ...liveViews(db).flatMap((v) => activeKeys(v.rules))]);
      let n = 0;
      for (const r of ruleIds) if (!had.has(r)) { db.rules[r] = { at: now() }; n++; }
      save(db);
      return n;
    },
    async libraryRemoveRule(ruleId) {
      const db = load(); db.rules ||= {};
      if (db.rules[ruleId]) db.rules[ruleId].removed = true;
      for (const v of liveViews(db)) if (v.rules[ruleId]) v.rules[ruleId].removed = true;
      save(db);
    },
    async libraryRemove(senseId) {
      const db = load();
      if (db.entries[senseId]) db.entries[senseId].removed = true;
      for (const v of liveViews(db)) if (v.senses[senseId]) v.senses[senseId].removed = true;
      save(db);
    },
    async patch(senseId, patch, note = null) {
      const db = load(), e = db.entries[senseId];
      if (patch == null || typeof patch !== "object" || Array.isArray(patch)) fail(MSG.patchShape);
      if (JSON.stringify(patch).length > 7000) fail(MSG.patchSize);
      if (!e || e.removed) fail(MSG.notInLibrary);
      e.patch = patch; e.note = String(note ?? "").trim() || null;
      save(db);
    },
    // The word itself lives in the game's own content in local mode; here it only joins the library.
    async createWord(card) {
      const word = senseFromCard(card).word;
      if (!word || word.length > MAX_WORD) fail(MSG.badWord);
      const known = Boolean(load().entries[word] && !load().entries[word].removed);
      await libraryAdd([word]);
      return { id: word, existing: known };
    },
    async add(view, senseIds) {
      if (!findView(load(), view)) fail(MSG.noView);
      if (senseIds.length > MAX_PER_CALL) fail(MSG.tooManyWords);
      await libraryAdd(senseIds);
      const db = load(), v = findView(db, view);
      let n = 0;
      for (const s of senseIds) {
        if (!db.entries[s] || db.entries[s].removed) continue;
        if (v.senses[s] && !v.senses[s].removed) continue;
        v.senses[s] = { at: now() }; n++;
      }
      save(db);
      return n;
    },
  };
}

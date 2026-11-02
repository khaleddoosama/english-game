// The data contract of a word (ADR 0011, docs/adr/0011-word-data-contract.md): which keys a stored word may hold,
// their shape, and how an older or incoming word is turned into that shape. No imports, no React, no network, so a
// plain Node script (scripts/word-contract-report.mjs) can run it too. The same shape rules are written in SQL as
// public.word_contract_errors (supabase/migrations/0044_word_contract_check.sql); tests/fixtures/word-contract-cases.json
// is run against both. Step 1 of the ADR: nothing in the app calls this module yet.

const WORD_TYPES = ["vocab", "idiom", "binomial", "phrasal", "fyi"];
const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "noun phrase", "verb phrase", "adjective phrase", "adverbial phrase", "phrasal verb", "idiom", "expression", "binomial phrase", "proper noun", "interjection", "preposition", "conjunction"];
// A course level (A1.1 … C2.3) or a plain difficulty (A1 … C2).
const LEVEL = /^[A-C][12](\.[1-3])?$/;
const BLANK = /_{2,}/g;
const HAS_BLANK = /_{2,}/;

// Every key a word may hold, in the order a converted word is written. Classes (ADR 0011, section 1): stored, system,
// derived (worked out when read, never stored), alias (accepted as input, converted), retired (archived by the
// approved migration, never written again).
export const WORD_KEYS = {
  word: { class: "stored", required: true }, id: { class: "stored" }, type: { class: "stored", required: true },
  category: { class: "stored", required: true }, subCategory: { class: "stored" }, units: { class: "stored" },
  level: { class: "stored" }, partsOfSpeech: { class: "stored" }, meaning: { class: "stored", required: true },
  situations: { class: "stored", required: "unless-stub" }, gaps: { class: "stored", required: "unless-stub" },
  hints: { class: "stored" }, plainForm: { class: "stored" }, transformExample: { class: "stored" },
  commonMistakes: { class: "stored" }, antonyms: { class: "stored" }, synonyms: { class: "stored" },
  confusableWords: { class: "stored" }, excludeFromSameOptionsWith: { class: "stored" }, pictureAvoid: { class: "stored" },
  collocations: { class: "stored" }, collocationChecks: { class: "stored" }, wordFamily: { class: "stored" },
  image: { class: "stored" }, illustration: { class: "stored" }, distractorGroup: { class: "stored" },
  learningData: { class: "stored" },
  categoryId: { class: "system" }, subCategoryTitle: { class: "system" }, _autoStub: { class: "system" },
  _aiAdded: { class: "system" }, gapsCheckedFor: { class: "system" }, contract: { class: "system" },
  situation: { class: "derived" }, gap: { class: "derived" }, commonMistake: { class: "derived" }, opposite: { class: "derived" },
  relations: { class: "alias" }, example: { class: "alias" }, links: { class: "alias" },
  register: { class: "retired" }, chainGroup: { class: "retired" }, acceptedWrittenAnswers: { class: "retired" },
  sentenceBuild: { class: "retired" },
};
// learningData keeps only cluster; difficulty is retired (the inner key alone).
const RETIRED_INNER = { learningData: ["difficulty"] };
const STRING_LISTS = ["units", "partsOfSpeech", "situations", "gaps", "hints", "antonyms", "synonyms", "confusableWords", "excludeFromSameOptionsWith", "pictureAvoid", "collocations"];
const MAX = { word: 120, id: 80, category: 60, subCategory: 60, meaning: 300, situations: 300, gaps: 300 };
// Lists the single-field aliases fold into: situation -> situations[0], gap -> gaps[0], commonMistake -> commonMistakes[0].
const SINGLE_OF = { situations: "situation", gaps: "gap", commonMistakes: "commonMistake" };

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const length = (s) => [...s].length; // characters, as SQL's char_length counts them
// Empty (ADR 0011, section 2): "", only spaces, null, [] or {}. false and 0 are values, never empty.
export function isEmpty(v) {
  return v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0) || (isObject(v) && Object.keys(v).length === 0);
}
// Text compared without case, extra spaces or end punctuation (. ! ?): "Same." equals "same".
const plain = (s) => String(s).trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase();
// Trimmed, inner spaces single. A picture link or drawing is only trimmed.
const tidy = (key, s) => (key === "image" || key === "illustration" ? s.trim() : s.trim().replace(/\s+/g, " "));
const sameItems = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tidyMistake = (m) => (isObject(m) ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v])) : m);

/* ---------------------------------------------------------------- the check */

// The shape rules of a stored word under the contract (ADR 0011, sections 3 and 6). errors: [{path, code}] — the
// same codes word_contract_errors gives in SQL. warnings: [{path, code}] — browser only. Options: words (a Set of
// the live words' names, lower case: a reference to no word warns), showsWord(word, text) (warns when a meaning,
// gap or hint shows the word; PR #83 has such a check).
export function checkWord(w, { words = null, showsWord = null } = {}) {
  const errors = [], warnings = [];
  const err = (path, code) => errors.push({ path, code });
  const warn = (path, code) => warnings.push({ path, code });
  if (!isObject(w)) { err("$", "not-object"); return { errors, warnings }; }
  for (const [key, value] of Object.entries(w)) {
    const spec = WORD_KEYS[key];
    if (!spec) { err(key, "unknown-key"); continue; }
    if (spec.class === "retired") { err(key, "retired-key"); continue; }
    if (spec.class === "derived" || spec.class === "alias") { err(key, "not-stored"); continue; }
    if (isEmpty(value)) err(key, "empty");
  }
  if (w.contract === undefined) err("contract", "required");
  else if (w.contract !== 1) err("contract", "type");
  const stub = w._autoStub === true;
  for (const [key, spec] of Object.entries(WORD_KEYS)) {
    if ((spec.required === true || (spec.required === "unless-stub" && !stub)) && w[key] === undefined) err(key, "required");
  }
  const text = (key, max) => {
    const v = w[key];
    if (v === undefined || isEmpty(v)) return;
    if (typeof v !== "string") return err(key, "type");
    if (max && length(v) > max) err(key, "too-long");
  };
  for (const key of ["word", "id", "category", "subCategory", "meaning", "plainForm", "distractorGroup", "categoryId", "subCategoryTitle", "gapsCheckedFor"]) text(key, MAX[key]);
  if (typeof w.type === "string" && w.type.trim() && !WORD_TYPES.includes(w.type)) err("type", "enum");
  if (w.level !== undefined && !isEmpty(w.level)) {
    if (typeof w.level !== "string") err("level", "type");
    else if (!LEVEL.test(w.level)) err("level", "enum");
  }
  for (const key of STRING_LISTS) {
    const v = w[key];
    if (v === undefined || isEmpty(v)) continue;
    if (!Array.isArray(v)) { err(key, "type"); continue; }
    const seen = new Set();
    v.forEach((item, i) => {
      const p = `${key}[${i}]`;
      if (typeof item !== "string") return err(p, "type");
      if (!item.trim()) return err(p, "empty");
      if (MAX[key] && length(item) > MAX[key]) err(p, "too-long");
      if (key === "gaps" && (item.match(BLANK) || []).length !== 1) err(p, "one-blank");
      if (key === "situations" && HAS_BLANK.test(item)) err(p, "has-blank");
      if (key === "partsOfSpeech" && !PARTS_OF_SPEECH.includes(item)) err(p, "enum");
      const k = item.trim().toLowerCase();
      if (seen.has(k)) err(p, "repeat");
      seen.add(k);
    });
    if (key === "partsOfSpeech" && v.length > 3) err(key, "too-many");
  }
  if (w.transformExample !== undefined && !isEmpty(w.transformExample)) {
    const t = w.transformExample;
    if (!isObject(t)) err("transformExample", "type");
    else {
      for (const k of Object.keys(t)) if (!["before", "after"].includes(k)) err(`transformExample.${k}`, "unknown-key");
      for (const k of ["before", "after"]) if (typeof t[k] !== "string" || !t[k].trim()) err(`transformExample.${k}`, typeof t[k] === "string" || t[k] === undefined ? "empty" : "type");
      if (!["phrasal", "fyi"].includes(w.type)) err("transformExample", "wrong-word-type");
    }
  }
  const objectList = (key, fields, check) => {
    const v = w[key];
    if (v === undefined || isEmpty(v)) return;
    if (!Array.isArray(v)) return err(key, "type");
    v.forEach((item, i) => {
      const p = `${key}[${i}]`;
      if (!isObject(item)) return err(p, "type");
      for (const k of Object.keys(item)) if (!fields.includes(k)) err(`${p}.${k}`, "unknown-key");
      check(item, p);
    });
  };
  const required = (item, p, k) => { if (typeof item[k] !== "string") err(`${p}.${k}`, item[k] === undefined ? "empty" : "type"); else if (!item[k].trim()) err(`${p}.${k}`, "empty"); };
  objectList("commonMistakes", ["sentence", "correction", "why"], (m, p) => {
    for (const k of ["sentence", "correction", "why"]) required(m, p, k);
    if (typeof m.sentence === "string" && typeof m.correction === "string" && m.sentence.trim() && plain(m.sentence) === plain(m.correction)) err(p, "same-as-correction");
  });
  objectList("collocationChecks", ["sentence", "answer", "wrong", "explanation"], (c, p) => {
    required(c, p, "sentence");
    if (typeof c.sentence === "string" && c.sentence.trim() && (c.sentence.match(BLANK) || []).length !== 1) err(`${p}.sentence`, "one-blank");
    required(c, p, "answer");
    if (!Array.isArray(c.wrong)) err(`${p}.wrong`, "type");
    else {
      const wrong = c.wrong.filter((x) => typeof x === "string" && x.trim());
      if (wrong.length !== c.wrong.length) err(`${p}.wrong`, "type");
      if (wrong.length < 2) err(`${p}.wrong`, "too-few");
      if (typeof c.answer === "string" && wrong.some((x) => x.trim().toLowerCase() === c.answer.trim().toLowerCase())) err(`${p}.wrong`, "equals-answer");
    }
    if (c.explanation !== undefined && (typeof c.explanation !== "string" || !c.explanation.trim())) err(`${p}.explanation`, typeof c.explanation === "string" ? "empty" : "type");
  });
  objectList("wordFamily", ["word", "pos"], (f, p) => {
    required(f, p, "word");
    if (f.pos === undefined) warn(`${p}.pos`, "missing");
    else if (typeof f.pos !== "string" || !f.pos.trim()) err(`${p}.pos`, typeof f.pos === "string" ? "empty" : "type");
  });
  if (w.image !== undefined && !isEmpty(w.image) && (typeof w.image !== "string" || !/^https:\/\/\S+$/.test(w.image))) err("image", typeof w.image === "string" ? "https" : "type");
  if (w.illustration !== undefined && !isEmpty(w.illustration)) {
    const s = w.illustration;
    if (typeof s !== "string") err("illustration", "type");
    else if (!/^\s*<svg[\s>]/i.test(s) || /<script|on\w+\s*=|javascript:/i.test(s) || length(s) > 12000) err("illustration", "svg");
  }
  if (w.learningData !== undefined && !isEmpty(w.learningData)) {
    const d = w.learningData;
    if (!isObject(d)) err("learningData", "type");
    else {
      for (const k of Object.keys(d)) if (k !== "cluster") err(`learningData.${k}`, RETIRED_INNER.learningData.includes(k) ? "retired-key" : "unknown-key");
      if (d.cluster === undefined) err("learningData.cluster", "required");
      else if (typeof d.cluster !== "string" || !d.cluster.trim()) err("learningData.cluster", typeof d.cluster === "string" ? "empty" : "type");
    }
  }
  for (const key of ["_autoStub", "_aiAdded"]) if (w[key] !== undefined && w[key] !== true) err(key, "true-only");
  // Warnings: shown to the person writing, never stored, not checked by the server.
  if (w.partsOfSpeech === undefined) warn("partsOfSpeech", "missing");
  if (words) (Array.isArray(w.confusableWords) ? w.confusableWords : []).forEach((x, i) => { if (typeof x === "string" && !words.has(x.trim().toLowerCase())) warn(`confusableWords[${i}]`, "no-such-word"); });
  if (showsWord && typeof w.word === "string") {
    if (typeof w.meaning === "string" && showsWord(w.word, w.meaning)) warn("meaning", "shows-word");
    for (const key of ["gaps", "hints"]) (Array.isArray(w[key]) ? w[key] : []).forEach((x, i) => { if (typeof x === "string" && showsWord(w.word, x)) warn(`${key}[${i}]`, "shows-word"); });
  }
  return { errors, warnings };
}

/* --------------------------------------------------------- the conversion */

// Turns a word in any older or incoming shape into the contract's shape, without deciding anything for the owner
// (ADR 0011, sections 4, 5 and 7). It never drops a value silently: each change is listed.
//   source "stored": a row already in content_items (retired and unknown keys go to `archive`, system keys stay).
//   source "input": a new write (retired, unknown, system and `contract` keys are refused in `errors`).
//   choices: { situations | gaps | commonMistakes: "A" } — Choice A for a conflict (section 4).
//   antonymChoices: { "<entry>": "move" | "archive" } — for relations.antonyms entries missing from antonyms (section 5).
// Returns { word, changes, archive, conflicts, antonymEntries, errors }. word is null while a conflict, an undecided
// relations.antonyms entry or an input error is open; otherwise it holds contract: 1 and only stored and system keys.
export function convertWord(raw, { source = "stored", choices = {}, antonymChoices = {} } = {}) {
  const changes = [], archive = [], conflicts = [], antonymEntries = [], errors = [];
  if (!isObject(raw)) return { word: null, changes, archive, conflicts, antonymEntries, errors: [{ path: "$", code: "not-object" }] };
  const out = {};
  const change = (path, what, detail) => changes.push({ path, what, ...detail });
  for (const [key, value] of Object.entries(raw)) {
    const spec = WORD_KEYS[key];
    if (!spec || spec.class === "retired") {
      if (source === "input") errors.push({ path: key, code: spec ? "retired-key" : "unknown-key" });
      else archive.push({ path: key, value, reason: spec ? "retired" : "unknown" });
      continue;
    }
    if (spec.class === "system" && source === "input") { errors.push({ path: key, code: "system-key" }); continue; }
    if (spec.class !== "stored" && spec.class !== "system") continue; // derived and alias keys are handled below
    if (key === "contract") continue;
    if (value === undefined || isEmpty(value)) { change(key, "empty-removed"); continue; }
    if (typeof value === "string") {
      const t = tidy(key, value);
      if (t !== value) change(key, "tidied");
      out[key] = t;
    } else if (STRING_LISTS.includes(key) && Array.isArray(value)) {
      const list = [];
      value.forEach((item, i) => {
        if (typeof item !== "string") { list.push(item); return; }
        if (!item.trim()) { change(`${key}[${i}]`, "empty-removed"); return; }
        const t = tidy(key, item);
        if (t !== item) change(`${key}[${i}]`, "tidied");
        list.push(t);
      });
      if (list.length) out[key] = list; else change(key, "empty-removed");
    } else if (key === "commonMistakes" && Array.isArray(value)) {
      out[key] = value.map(tidyMistake);
    } else if (key === "learningData" && isObject(value)) {
      const kept = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "cluster") kept.cluster = typeof v === "string" ? v.trim() : v;
        else if (source === "input") errors.push({ path: `learningData.${k}`, code: RETIRED_INNER.learningData.includes(k) ? "retired-key" : "unknown-key" });
        else archive.push({ path: `learningData.${k}`, value: v, reason: RETIRED_INNER.learningData.includes(k) ? "retired" : "unknown" });
      }
      if (Object.keys(kept).length && !isEmpty(kept.cluster)) out.learningData = kept;
      else change("learningData", "empty-removed");
    } else {
      out[key] = value; // false, 0 and wrong types stay, for checkWord to refuse
    }
  }
  // Single fields (situation, gap, commonMistake): folded into their lists, never deciding a conflict.
  for (const [listKey, singleKey] of Object.entries(SINGLE_OF)) {
    if (!(singleKey in raw)) continue;
    const rawSingle = raw[singleKey];
    if (isEmpty(rawSingle)) { change(singleKey, "empty-removed"); continue; }
    const single = typeof rawSingle === "string" ? tidy(singleKey, rawSingle) : tidyMistake(rawSingle);
    const list = Array.isArray(out[listKey]) ? out[listKey] : null;
    if (!list) { out[listKey] = [single]; change(singleKey, "moved", { to: `${listKey}[0]` }); continue; }
    if (sameItems(list[0], single)) { change(singleKey, "derived-dropped"); continue; }
    const at = list.findIndex((x) => sameItems(x, single));
    const conflict = { field: listKey, single, first: list[0], list: [...list], alsoAt: at > 0 ? at : null };
    if (choices[listKey] === "A" && at < 0) {
      // Choice A: the shown value becomes [0] and the old [0] goes last. Nothing is removed (section 4).
      out[listKey] = [single, ...list.slice(1), list[0]];
      change(listKey, "choice-a", { before: list, after: out[listKey] });
    } else {
      conflicts.push({ ...conflict, open: true, reason: at > 0 ? "single-elsewhere-in-list" : "single-differs-from-first" });
    }
  }
  // opposite: derived; on input or in a stored row it is folded into antonyms ("None" means none).
  if ("opposite" in raw) {
    const o = raw.opposite;
    if (typeof o === "string" && o.trim() && o.trim().toLowerCase() !== "none") {
      const list = out.antonyms || [];
      if (list.some((x) => typeof x === "string" && x.toLowerCase() === o.trim().toLowerCase())) change("opposite", "derived-dropped");
      else { out.antonyms = [...list, o.trim()]; change("opposite", "moved", { to: "antonyms" }); }
    } else change("opposite", isEmpty(o) || typeof o === "string" ? "empty-removed" : "dropped-not-text", { value: o });
  }
  // relations: flattened into the top-level lists; relations.antonyms entries missing from antonyms wait for the
  // owner (section 5).
  if ("relations" in raw) {
    const r = raw.relations;
    change("relations", "flattened");
    if (!isObject(r)) { if (!isEmpty(r)) (source === "input" ? errors.push({ path: "relations", code: "type" }) : archive.push({ path: "relations", value: r, reason: "unknown" })); }
    else for (const [k, v] of Object.entries(r)) {
      const target = { synonyms: "synonyms", confusableWords: "confusableWords", antonyms: "antonyms" }[k];
      if (!target) { if (source === "input") errors.push({ path: `relations.${k}`, code: "unknown-key" }); else archive.push({ path: `relations.${k}`, value: v, reason: "unknown" }); continue; }
      const items = (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().replace(/\s+/g, " "));
      const list = out[target] || [];
      for (const item of items) {
        if (list.some((x) => typeof x === "string" && x.toLowerCase() === item.toLowerCase())) { change(`relations.${k}`, "derived-dropped", { value: item }); continue; }
        if (k === "antonyms" && source === "stored") {
          const decision = antonymChoices[item];
          antonymEntries.push({ value: item, decision: decision || null });
          if (decision === "move") { list.push(item); change(`relations.${k}`, "moved", { value: item, to: target }); }
          else if (decision === "archive") archive.push({ path: `relations.antonyms`, value: item, reason: "owner-choice" });
          continue;
        }
        list.push(item);
        change(`relations.${k}`, "moved", { value: item, to: target });
      }
      if (list.length) out[target] = list;
    }
  }
  // example: an older name for an example sentence, added last when not there yet.
  if ("example" in raw && !isEmpty(raw.example)) {
    const e = typeof raw.example === "string" ? tidy("example", raw.example) : raw.example;
    const list = out.situations || [];
    if (list.some((x) => sameItems(x, e))) change("example", "derived-dropped");
    else { out.situations = [...list, e]; change("example", "moved", { to: `situations[${list.length}]` }); }
  }
  if ("links" in raw) (source === "input" ? errors.push({ path: "links", code: "v3-only" }) : archive.push({ path: "links", value: raw.links, reason: "unknown" }));
  const open = conflicts.length > 0 || antonymEntries.some((a) => !a.decision) || errors.length > 0;
  const word = open ? null : ordered({ ...out, contract: 1 });
  return { word, changes, archive, conflicts, antonymEntries, errors };
}

// A partial update (ADR 0011, section 2): an absent key keeps its value; a present value replaces it (a list replaces
// the whole list); an empty value clears an optional key and is an error for a required one. previous must be a
// converted word. Returns { word, errors }; the caller still runs checkWord on word.
export function updateWord(previous, patch) {
  const errors = [];
  if (!isObject(previous) || !isObject(patch)) return { word: null, errors: [{ path: "$", code: "not-object" }] };
  const next = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const spec = WORD_KEYS[key];
    if (!spec) { errors.push({ path: key, code: "unknown-key" }); continue; }
    if (spec.class === "retired") { errors.push({ path: key, code: "retired-key" }); continue; }
    if (spec.class === "system") { errors.push({ path: key, code: "system-key" }); continue; }
    if (spec.class !== "stored") { errors.push({ path: key, code: "not-stored" }); continue; }
    if (isEmpty(value)) {
      if (spec.required === true || (spec.required === "unless-stub" && previous._autoStub !== true)) errors.push({ path: key, code: "required" });
      else delete next[key];
      continue;
    }
    next[key] = typeof value === "string" ? tidy(key, value) : value;
  }
  if (errors.length) return { word: null, errors };
  // A category or group change makes the v3 ids stale (section 3).
  if ("category" in patch && patch.category !== previous.category) delete next.categoryId;
  if ("subCategory" in patch && patch.subCategory !== previous.subCategory) delete next.subCategoryTitle;
  return { word: ordered({ ...next, contract: 1 }), errors };
}

// Keys in WORD_KEYS order, so the same word always reads the same.
function ordered(w) {
  const out = {};
  for (const key of Object.keys(WORD_KEYS)) if (w[key] !== undefined) out[key] = w[key];
  return out;
}

// The text behind each practice-pool id, for a word as it is read today and as a converted word: seed is the single
// field (what the first question shows), seed-2 … are list[1] …. Used by the dry run to show that Choice A keeps every
// sentence with its counts (ADR 0011, section 4).
export function poolTexts(raw, listKey) {
  const singleKey = SINGLE_OF[listKey];
  const list = Array.isArray(raw?.[listKey]) && raw[listKey].length ? raw[listKey] : raw?.[singleKey] !== undefined ? [raw[singleKey]] : [];
  const first = raw?.[singleKey] !== undefined && !isEmpty(raw[singleKey]) ? raw[singleKey] : list[0];
  return list.map((text, i) => ({ id: i ? `seed-${i + 1}` : "seed", text: i ? text : first }));
}

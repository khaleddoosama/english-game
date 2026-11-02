// Dry run of the word contract (ADR 0011, sections 4, 5 and 7): reads the stored word rows from a file and reports, per
// word, what converting it would change, archive, or leave to the owner. It only reads a file and writes a report: it
// never connects to a database and never writes one.
//   node scripts/word-contract-report.mjs <rows.json> [--out report.json]
// rows.json: the raw rows of content_items (not the game's copy, which has derived values), for example
//   psql "$URL" -At -c "select coalesce(json_agg(json_build_object('kind', kind, 'key', key, 'data', data, 'deleted', deleted)), '[]') from public.content_items where kind = 'words'" > rows.json
// Not in this step (see notComputed in the report): practice counts per player for each conflict (a read of
// progress, step 6), the library links that would change (step 3), and a recommendation for each relations.antonyms
// entry (written by a person from what the report shows).
import { readFileSync, writeFileSync } from "node:fs";
import { checkWord, convertWord, poolTexts } from "../src/engine/wordContract.js";

const lower = (s) => String(s).trim().toLowerCase();
const count = (map, key) => { map[key] = (map[key] || 0) + 1; };

export function buildReport(input) {
  const rows = (Array.isArray(input) ? input : input?.rows || []).filter((r) => r && r.kind === "words");
  const live = rows.filter((r) => !r.deleted && r.data && typeof r.data === "object");
  const liveNames = new Map(live.map((r) => [lower(r.data.word ?? r.key), r]));
  const deletedNames = new Set(rows.filter((r) => r.deleted).map((r) => lower(r.key)));
  const summary = { activeWords: live.length, converts: 0, needsDecision: 0, failsCheck: 0, alreadyConverted: 0, notIdempotent: 0, changes: {}, archived: {}, conflicts: 0, antonymEntries: 0, confusableReferences: { live: 0, deleted: 0, none: 0 } };
  const words = live.map((row) => {
    const raw = row.data;
    if (raw.contract === 1) summary.alreadyConverted++;
    const r = convertWord(raw);
    const conflicts = r.conflicts.map((c) => {
      // What Choice A would give, and the text behind every practice-pool id before and after (section 4).
      const choiceA = c.reason === "single-differs-from-first" ? [c.single, ...c.list.slice(1), c.list[0]] : null;
      const before = poolTexts(raw, c.field);
      const after = choiceA ? poolTexts({ [c.field]: choiceA }, c.field) : null;
      const keepsTexts = after ? before.every((b) => after.find((a) => a.id === b.id)?.text === b.text) : false;
      return { field: c.field, shown: c.single, listFirst: c.first, list: c.list, reason: c.reason, choiceA, poolBefore: before, poolAfterChoiceA: after, choiceAKeepsEveryPoolText: keepsTexts };
    });
    const antonymEntries = r.antonymEntries.map((a) => {
      const other = liveNames.get(lower(a.value));
      return {
        value: a.value,
        namesLiveWord: !!other,
        thisMeaning: raw.meaning ?? null,
        otherMeaning: other?.data?.meaning ?? null,
        effect: other ? `moving it makes "${raw.word ?? row.key}" and "${other.data.word ?? other.key}" an opposite pair in play (Opposite Battle, its pair questions, Live)` : "moving it adds an antonym that is not a word in the game (Opposite Clue only)",
        recommendation: null,
      };
    });
    const confusable = [...(Array.isArray(raw.confusableWords) ? raw.confusableWords : []), ...(Array.isArray(raw.relations?.confusableWords) ? raw.relations.confusableWords : [])]
      .filter((x) => typeof x === "string")
      .map((value) => ({ value, class: liveNames.has(lower(value)) ? "live" : deletedNames.has(lower(value)) ? "deleted" : "none" }));
    confusable.forEach((c) => summary.confusableReferences[c.class]++);
    const check = r.word ? checkWord(r.word, { words: new Set(liveNames.keys()) }) : null;
    let status = "converts";
    if (!r.word) status = "needs-decision";
    else if (check.errors.length) status = "fails-check";
    if (status === "converts") summary.converts++;
    else if (status === "needs-decision") summary.needsDecision++;
    else summary.failsCheck++;
    if (r.word) {
      const again = convertWord(r.word);
      if (JSON.stringify(again.word) !== JSON.stringify(r.word) || again.changes.length) summary.notIdempotent++;
    }
    r.changes.forEach((c) => count(summary.changes, c.what));
    r.archive.forEach((a) => count(summary.archived, a.path));
    summary.conflicts += conflicts.length;
    summary.antonymEntries += antonymEntries.length;
    return {
      key: row.key, status, changes: r.changes, archive: r.archive, conflicts, antonymEntries,
      checkErrors: check ? check.errors : null, checkWarnings: check ? check.warnings : null, confusableReferences: confusable,
    };
  });
  return {
    summary,
    notComputed: [
      "practice counts per player on each conflicting field (a read of progress; step 6)",
      "library links that would change (step 3)",
      "a recommendation for each relations.antonyms entry (written by a person from this report)",
      "sentences that show the word (the check of PR #83 is not on this branch)",
    ],
    words,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) { console.error("usage: node scripts/word-contract-report.mjs <rows.json> [--out report.json]"); process.exit(2); }
  const report = buildReport(JSON.parse(readFileSync(file, "utf8")));
  const out = rest[rest.indexOf("--out") + 1];
  if (rest.includes("--out") && out) writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  if (!rest.includes("--out")) console.log("(add --out report.json for the word-by-word report)");
}

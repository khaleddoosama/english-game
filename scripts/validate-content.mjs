// Checks content files (imports/*.json by default) with the game's own import
// code, then adds the checks the import does not make. No network, no database.
//
//   npm run validate:content                      every file in imports/
//   npm run validate:content -- path/to/file.json  one or more files
//   node scripts/validate-content.mjs --against backup.json file.json
//                                                  links to words that are only in the backup
//   node scripts/validate-content.mjs --hook       Claude Code hook: reads the tool call from stdin,
//                                                  checks only imports/*.json, exits 2 on errors
//
// Errors fail the run (exit 1). Warnings are printed and do not.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARABIC = /[؀-ۿ]/;
const BLANK = /_{2,}/g;
// Player data in a backup (reports, progress) may be in Arabic; only game content must not.
const CONTENT_KEYS = ["note", "categories", "words", "grammar", "stories", "combos", "challenges"];

const plain = (s) => String(s ?? "").normalize("NFKD").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();

// Every string in the file, with its path, so one rule can scan all of them.
function* strings(value, path = "") {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k);
}

// `engine` is { V2, inspectImport }, loaded by the caller (Vite here, Vitest in the tests).
// `existing` is content the file may link into (a backup's content), {} by default.
export function checkContent(text, engine, existing = {}) {
  const errors = [], warnings = [];
  const { V2, inspectImport } = engine;
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { errors: [`not valid JSON (${e.message})`], warnings }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["not a Word Hunter content file"], warnings };

  // 1. The game's own checks: exactly what Import & Export runs before it accepts a file.
  try {
    const check = inspectImport(text, existing);
    warnings.push(...check.warnings);
  } catch (e) {
    errors.push(...(e.issues?.length ? e.issues : [e.message]));
  }

  // 2. No puns in new content (the import drops them silently, so say so).
  if (Array.isArray(raw.puns) && raw.puns.length) errors.push(`puns: ${raw.puns.length} found. No puns in new content (the import would drop them)`);

  // 3. English only: no Arabic characters anywhere in the game content.
  const contentOnly = Object.fromEntries(CONTENT_KEYS.filter((k) => k in raw).map((k) => [k, raw[k]]));
  for (const [path, s] of strings(contentOnly)) if (ARABIC.test(s)) errors.push(`${path}: contains Arabic characters; game content must be English only`);

  // 4. Duplicates inside the file (an import overwrites by name or id).
  const seen = (list, key, label) => {
    const names = new Map();
    (Array.isArray(list) ? list : []).forEach((item, i) => {
      const k = V2.norm(item?.[key]);
      if (!k) return;
      if (names.has(k)) errors.push(`${label}[${i}].${key}: "${item[key]}" appears twice (first at ${label}[${names.get(k)}]); the second would overwrite the first`);
      else names.set(k, i);
    });
  };
  seen(raw.words, "word", "words");
  seen(raw.grammar, "id", "grammar");

  // 5. Gap sentences. The game compares the typed answer with the `word` field
  //    (no conjugation handling), so the base form must fit the blank as written.
  const prepared = V2.prepareImport(raw, existing).data;
  (prepared.words || []).forEach((w, i) => {
    if (w._autoStub) return;
    const head = plain(V2.bareWord(w.word));
    const gaps = Array.isArray(w.gaps) ? w.gaps : w.gap ? [w.gap] : [];
    gaps.forEach((gap, j) => {
      const at = `words[${i}] "${w.word}" gap ${j + 1}`;
      const blanks = String(gap).match(BLANK) || [];
      if (blanks.length !== 1) { errors.push(`${at}: needs exactly one blank (______), found ${blanks.length}`); return; }
      if (/[A-Za-z0-9]_{2,}|_{2,}[A-Za-z0-9]/.test(gap)) errors.push(`${at}: letters are attached to the blank ("${gap.match(/[A-Za-z0-9]*_{2,}[A-Za-z0-9]*/)[0]}"). The game expects the base form "${w.word}", with no ending added`);
      const rest = ` ${plain(String(gap).replace(BLANK, " "))} `;
      if (head && rest.includes(` ${head} `)) errors.push(`${at}: the sentence already contains "${head}" outside the blank (answer leaked)`);
    });
  });

  return { errors, warnings };
}

async function loadEngine() {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: ROOT, configFile: false, logLevel: "silent", appType: "custom", server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  const { V2 } = await vite.ssrLoadModule("/src/engine/v2.js");
  const { inspectImport } = await vite.ssrLoadModule("/src/features/data/transfer.js");
  return { engine: { V2, inspectImport }, close: () => vite.close() };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv) {
  const hook = argv.includes("--hook");
  let files = [], againstPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--hook") continue;
    if (argv[i] === "--against") againstPath = argv[++i];
    else files.push(argv[i]);
  }
  if (hook) {
    let call = {};
    try { call = JSON.parse(await readStdin()); } catch {}
    const file = call?.tool_input?.file_path;
    if (typeof file !== "string" || !/(^|[\\/])imports[\\/][^\\/]+\.json$/.test(file)) return 0;
    if (!existsSync(file)) return 0; // deleted or moved: nothing to check
    files = [file];
  } else if (!files.length) {
    const dir = join(ROOT, "imports");
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
  }

  const { engine, close } = await loadEngine();
  let existing = {};
  if (againstPath) {
    const backup = JSON.parse(readFileSync(againstPath, "utf8"));
    existing = engine.V2.withoutRemovedFields(engine.V2.contentOnly(backup));
  }
  let failed = 0;
  const out = [];
  for (const file of files) {
    const { errors, warnings } = checkContent(readFileSync(file, "utf8"), engine, existing);
    out.push(`${file}: ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
    for (const e of errors) out.push(`  ERROR   ${e}`);
    for (const w of warnings) out.push(`  warning ${w}`);
    if (errors.length) failed++;
  }
  await close();
  const report = out.join("\n");
  if (hook) { if (failed) { process.stderr.write(`Content check failed. Fix these before moving on:\n${report}\n`); return 2; } return 0; }
  console.log(report);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}

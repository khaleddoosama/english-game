// The checks of docs/development-workflow.md that a machine can make on a pull request: the description has its
// sections and one type, the files changed fit that type, a bug fix or a feature comes with a test (or says why not),
// and the docs line says what was updated (with a doc in the diff) or why nothing was. It does not judge whether
// the docs are right or the work was done in order: that is review.
//   PR_BODY="..." node scripts/pr-rules.mjs <changed file>...     (CI: .github/workflows/pr-rules.yml)
// Exit 1 with one line per problem.

export const SECTIONS = ["Why", "What changed", "Verification", "Docs", "Risks and gaps"];
export const TYPES = ["Refactor", "Bug fix", "Feature", "Data or permissions", "Docs or tooling"];

const APP_CODE = /^(src|api)\//;
const MIGRATION = /^supabase\/(migrations|rollback)\//;
const TEST = /^(tests\/|e2e\/specs\/|supabase\/tests\/)/;
const DOC = /(^docs\/.*\.md$|^[^/]+\.md$|^\.github\/pull_request_template\.md$)/;

// "## Why" ... up to the next "## " heading; HTML comments (the template's hints) are not content.
export function sections(body) {
  const clean = String(body || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  const out = {};
  let name = null;
  for (const line of clean.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { name = h[1]; out[name] = ""; continue; }
    if (name !== null) out[name] += line + "\n";
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

export function checkedTypes(body) {
  const clean = String(body || "").replace(/<!--[\s\S]*?-->/g, "");
  return TYPES.filter((t) => new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${t.replace(/ /g, "\\s+")}\\b`, "m").test(clean));
}

// A reason is a few real words, not "n/a" or "-".
const hasReason = (text) => (String(text || "").match(/[A-Za-z؀-ۿ]{2,}/g) || []).length >= 4;

export function problems(body, files) {
  const out = [];
  const s = sections(body);
  for (const name of SECTIONS) {
    if (!(name in s)) out.push(`The description has no "## ${name}" section (see .github/pull_request_template.md).`);
    else if (!s[name]) out.push(`The "## ${name}" section is empty.`);
  }
  const types = checkedTypes(body);
  if (types.length !== 1) out.push(`Tick exactly one type (${TYPES.join(", ")}); ticked: ${types.length ? types.join(", ") : "none"}. Behaviour changes and refactors go in separate PRs.`);
  const type = types.length === 1 ? types[0] : null;

  const code = files.filter((f) => APP_CODE.test(f));
  const migrations = files.filter((f) => MIGRATION.test(f));
  const tests = files.filter((f) => TEST.test(f));
  const docs = files.filter((f) => DOC.test(f));

  if (type === "Docs or tooling" && code.length) out.push(`Type "Docs or tooling" changes no app code, but these changed: ${code.join(", ")}.`);
  if (migrations.length && type !== "Data or permissions") out.push(`Database migrations changed (${migrations.join(", ")}): the type must be "Data or permissions", which needs the owner's approval.`);
  if ((type === "Bug fix" || type === "Feature") && !tests.length) {
    const why = (s.Verification || "").match(/No new test:\s*([\s\S]*)/i);
    if (!why || !hasReason(why[1])) out.push(`A ${type.toLowerCase()} needs a test in tests/, e2e/specs/ or supabase/tests/, or "No new test: <reason>" under Verification.`);
  }

  const docsText = s.Docs || "";
  const updated = /^\s*Updated\b/im.test(docsText);
  const notNeeded = docsText.match(/^\s*Not needed\b:?\s*([\s\S]*)/im);
  if ("Docs" in s && docsText) {
    if (!updated && !notNeeded) out.push(`Under "## Docs", start with "Updated:" (and list the pages) or "Not needed: <reason>".`);
    if (updated && !docs.length) out.push(`"## Docs" says Updated, but no documentation file changed in this PR.`);
    if (!updated && notNeeded && !hasReason(notNeeded[1])) out.push(`"Not needed" under "## Docs" needs a reason (a short sentence).`);
    if (!updated && notNeeded && (type === "Feature" || type === "Data or permissions")) out.push(`A ${type.toLowerCase()} changes what the game does or stores: update the module's docs.`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = problems(process.env.PR_BODY || "", process.argv.slice(2).filter(Boolean));
  if (found.length) {
    for (const p of found) console.log(`PR rule: ${p}`);
    process.exit(1);
  }
  console.log("PR rules: OK");
}

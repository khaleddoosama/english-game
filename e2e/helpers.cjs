// What every browser spec shares: where the app is, how to start Chromium, a
// pass/fail printer, and where screenshots go. Specs run against the built app
// (`vite preview`) in local mode, so they need no database.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const APP = process.env.E2E_BASE_URL || 'http://localhost:4176';
const OUT = path.join(__dirname, 'out');                         // screenshots, not committed
const ROOT = path.join(__dirname, '..');
const BACKUP = path.join(ROOT, 'word-hunter-backup.json');       // the whole course, for "Import & Export"
const COURSE_BACKUP = path.join(__dirname, 'fixtures', 'course-backup.json');
fs.mkdirSync(OUT, { recursive: true });

// CHROME_PATH, else Playwright's own download, else any Chromium under PLAYWRIGHT_BROWSERS_PATH (/opt/pw-browsers).
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const own = chromium.executablePath();
  if (own && fs.existsSync(own)) return own;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* no browsers folder */ }
  return undefined;
}

const FIXTURE = (name) => path.join(__dirname, 'fixtures', name);
const opened = [];
const launch = async () => { const b = await chromium.launch({ executablePath: chromePath() }); opened.push(b); return b; };
let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) { failed++; process.exitCode = 1; } };

// A spec is `run(async () => { ... })`: an uncaught error counts as a failure, with the message.
const run = (fn) => fn()
  .catch((e) => { console.log(`FAIL spec crashed: ${String(e.message).split('\n')[0]}`); process.exitCode = 1; })
  .finally(() => Promise.all(opened.map((b) => b.close().catch(() => {}))));

module.exports = { APP, OUT, SP: OUT, ROOT, BACKUP, COURSE_BACKUP, FIXTURE, launch, ok, run, get failed() { return failed; } };

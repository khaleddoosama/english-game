// Runs the browser specs in e2e/specs against the built app (local mode, no
// database): starts `vite preview`, runs each spec in its own process, prints a
// summary and exits non-zero if anything failed.
//   npm run e2e                       all specs (builds first if dist/ is missing)
//   npm run e2e -- library catalog    only the specs whose name contains one of these
//   E2E_BASE_URL=http://host:port npm run e2e    against an app that is already running
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 4176;
const BASE = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const wanted = process.argv.slice(2);
const specs = fs.readdirSync(path.join(__dirname, 'specs')).filter((f) => f.endsWith('.cjs')).sort()
  .filter((f) => !wanted.length || wanted.some((w) => f.includes(w)));

const up = () => new Promise((res) => http.get(BASE, (r) => { r.resume(); res(true); }).on('error', () => res(false)));
async function waitUp() { for (let i = 0; i < 60; i++) { if (await up()) return true; await new Promise((r) => setTimeout(r, 500)); } return false; }

(async () => {
  let server = null;
  if (!process.env.E2E_BASE_URL) {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.log('building…'); if (spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' }).status) process.exit(1); }
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  }
  if (!(await waitUp())) { console.log(`the app did not come up at ${BASE}`); server?.kill(); process.exit(1); }
  const results = [];
  for (const f of specs) {
    const t = Date.now();
    const r = spawnSync('node', [path.join(__dirname, 'specs', f)], { encoding: 'utf8', timeout: 180000, env: { ...process.env, E2E_BASE_URL: BASE } });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
    const passes = out.split('\n').filter((l) => l.startsWith('PASS')).length;
    const good = r.status === 0 && !fails.length && passes > 0;
    results.push({ f, good, passes, fails, secs: ((Date.now() - t) / 1000).toFixed(0), crash: r.status !== 0 && !fails.length ? out.split('\n').slice(-6).join('\n') : '' });
    console.log(`${good ? 'ok  ' : 'FAIL'} ${f} (${passes} checks, ${results.at(-1).secs}s)`);
    for (const l of fails) console.log(`       ${l}`);
    if (results.at(-1).crash) console.log(`       ${results.at(-1).crash.replace(/\n/g, '\n       ')}`);
  }
  server?.kill();
  const bad = results.filter((r) => !r.good);
  console.log(`\n${results.length - bad.length}/${results.length} specs passed`);
  process.exit(bad.length ? 1 : 0);
})();

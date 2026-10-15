/* global WHRepo -- the repo bundle, loaded by the page this spec opens */
// A save whose answer is lost, a real tab closed, another device saving, the tab opened again - with the
// game's own repo code (src/lib/repo.js, bundled for the browser), a REAL IndexedDB in Chromium, and a REAL
// PostgreSQL (migrations applied) behind it. Needs PGURL; without it the spec is skipped.
//
// Proven: the unanswered save (with its operation id) survives a real tab close in the browser's own
// IndexedDB, is asked about again when the next tab opens, and is not counted twice although another device
// saved in between. NOT proven: supabase-js, PostgREST, GoTrue (the calls go through the integration
// harness, which sets role and JWT claims itself), the React app around the repo, a service worker, or a
// real network. See docs/integration-tests.md.
const fs = require('node:fs');
const path = require('node:path');
const { ok, launch, run, OUT, ROOT } = require('../helpers.cjs');

const ORIGIN = 'https://wh.test';

run(async () => {
  if (!process.env.PGURL) { console.log('SKIP needs PGURL (a database with every migration applied); see docs/integration-tests.md'); return; }
  const { build } = await import('vite');
  const { as, cleanup, newTag, signUp, superuser } = await import('../../tests/integration/harness.js');

  // the repo, as the browser gets it
  const outDir = path.join(OUT, 'repo-bundle');
  await build({ root: ROOT, configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir, emptyOutDir: true, minify: false, copyPublicDir: false, lib: { entry: path.join(ROOT, 'src/lib/repo.js'), name: 'WHRepo', formats: ['iife'], fileName: () => 'repo.js' } } });
  const bundle = fs.readFileSync(path.join(outDir, 'repo.js'), 'utf8');

  const tag = newTag();
  const ann = await signUp(`${tag}ann`);
  const client = as(ann.id);
  const core = () => superuser.rows(`select data, rev from public.progress where user_id = '${ann.id}' and section = 'core'`)[0];
  const profile = () => superuser.rows(`select score, week_score from public.profiles where id = '${ann.id}'`)[0];

  const browser = await launch();
  const state = (score) => ({ score, attempted: score / 10, mastery: {}, sessionLogs: [] });

  // One device = one browser context (its own IndexedDB). A tab on it has the repo and a bridge to PostgreSQL.
  const device = async () => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const dev = { context, loseAnswers: false, errors: [] };
    dev.openTab = async () => {
      const page = await context.newPage();
      page.on('pageerror', (e) => dev.errors.push(e.message));
      await page.route(`${ORIGIN}/**`, (route) => (route.request().url().endsWith('/repo.js')
        ? route.fulfill({ contentType: 'text/javascript', body: bundle })
        : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>repo</title><script src="/repo.js"></script>' })));
      await page.exposeFunction('__rpc', async (name, args) => {
        const out = await client.rpc(name, args);
        if (name === 'save_progress_v2' && dev.loseAnswers) return { data: null, error: { message: 'TypeError: Failed to fetch' } };   // the database saved it; the answer is lost
        return { data: out.data ?? null, error: out.error ? { message: out.error.message, code: out.error.code } : null };
      });
      await page.exposeFunction('__query', async (table, ops) => {
        let q = client.from(table);
        for (const [method, ...args] of ops) q = q[method](...args);
        const out = await q;
        return { data: out.data ?? null, error: out.error ? { message: out.error.message, code: out.error.code } : null };
      });
      await page.goto(`${ORIGIN}/`);
      if (dev.errors.length) throw new Error('the page failed to load: ' + dev.errors.join(' | '));
      await page.evaluate((userId) => {
        const chain = (table) => { const ops = []; const q = new Proxy({}, { get: (_, m) => (m === 'then' ? (res, rej) => window.__query(table, ops).then(res, rej) : (...a) => { ops.push([m, ...a]); return q; }) }); return q; };
        const bridge = { rpc: (name, args) => window.__rpc(name, args), from: chain };
        window.repo = WHRepo.createSupabaseRepo({ userId, isAdmin: false, client: bridge });
      }, ann.id);
      return page;
    };
    return dev;
  };

  try {
    const phone = await device(), tablet = await device();
    let tab = await phone.openTab();
    const other = await tablet.openTab();

    // both devices start from 100
    await tab.evaluate(async (s) => { await window.repo.loadProgress(); await window.repo.saveProgress(s); }, state(100));
    await other.evaluate(async () => { await window.repo.loadProgress(); });
    ok(core().data.score === 100, 'the phone saved 100; the tablet loaded it');

    // the phone plays to 150: the database gets it, the answer is lost, the tab is closed at once
    phone.loseAnswers = true;
    await tab.evaluate(async (s) => { await window.repo.saveProgress(s); }, state(150));
    ok(core().data.score === 150, 'the save of 150 reached the database although the phone never got the answer');
    await tab.close();                                                   // a real tab close

    // the tablet, which knew only 100, plays to 130 and saves: it merges, the database holds 180
    await other.evaluate(async (s) => { await window.repo.saveProgress(s); }, state(130));
    ok(core().data.score === 180, 'the tablet merged its 30 into the 150: the database holds 180');

    // the phone opens a new tab on the same browser profile (the same IndexedDB)
    phone.loseAnswers = false;
    tab = await phone.openTab();
    const snap = await tab.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('word-hunter', 1);
      open.onsuccess = () => { const q = open.result.transaction('kv', 'readonly').objectStore('kv').getAll(); q.onsuccess = () => resolve(q.result.map((v) => ({ dirty: v?.dirty, op: v?.inflight?.op || null, score: v?.data?.score }))); };
    }));
    console.log('what the closed tab left in IndexedDB:', JSON.stringify(snap));
    ok(snap.some((s) => s.dirty === true && /^[0-9a-f-]{36}$/.test(s.op || '') && s.score === 150), 'the closed tab left its unanswered save, with its id, in the browser\'s IndexedDB');
    const loaded = await tab.evaluate(async () => window.repo.loadProgress());
    ok(loaded.score === 180 && loaded.attempted === 18, `the new tab loads 180, not 230 (score ${loaded.score}, attempted ${loaded.attempted})`);
    await tab.evaluate(async (d) => { await window.repo.saveProgress(d); }, loaded);
    ok(core().data.score === 180 && core().data.attempted === 18, 'saving what it loaded changes nothing on the server');
    ok(profile().score === 180 && profile().week_score === 180, 'leaderboard score 180, this week 180 (each point once)');
    const clean = await tab.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('word-hunter', 1);
      open.onsuccess = () => { const q = open.result.transaction('kv', 'readonly').objectStore('kv').getAll(); q.onsuccess = () => resolve(q.result.every((v) => !v?.inflight)); };
    }));
    ok(clean, 'afterwards nothing is left pending on the device');
    ok(![...phone.errors, ...tablet.errors].length, 'no page errors ' + [...phone.errors, ...tablet.errors].join(' / '));
  } finally {
    cleanup(tag);
  }
});

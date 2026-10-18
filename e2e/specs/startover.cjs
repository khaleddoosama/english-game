// "Start over" on Import & export, in a real browser (local mode, the local player is the admin), with made-up content
// (fixtures/content-admin.json): "Reset progress" clears the progress and keeps the content; "Delete everything"
// (Admin -> Import & export) clears both. Each result is read from what the game saved (IndexedDB) and again after a
// reload.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');

const idb = (page, key, value) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => {
    const store = open.result.transaction('kv', v === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    if (v === undefined) { const g = store.get(k); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); }
    else { const g = store.get(k); g.onsuccess = () => { store.put({ ...(g.result || {}), ...v }, k).onsuccess = () => resolve(); }; }
  };
  open.onerror = () => resolve(null);
}), [key, value]);
const saved = async (page) => {
  const content = await idb(page, 'local:content'), progress = await idb(page, 'local:progress');
  return { words: (content?.words || []).length, order: content?.levelOrder || [], score: progress?.score ?? 0, practised: Object.keys(progress?.mastery || {}).length };
};
const withProgress = async (page) => {
  await idb(page, 'local:progress', { score: 80, mastery: { Drizzle: { total: 3, correct: 2, recent: [] }, Gust: { total: 1, correct: 1, recent: [] } } });
};
const confirm = async (page, button, yes) => {
  await page.click(`button:has-text("${button}")`); await page.waitForTimeout(400);
  await page.click(`button:has-text("${yes}")`); await page.waitForTimeout(2000);
};

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(2000);
  await withProgress(page);
  await page.goto(APP + '/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const start = await saved(page);
  ok(start.words === 6 && start.score === 80 && start.practised === 2, 'start: 6 words, 80 points, 2 words practised');

  // Reset progress (the /data page): the progress goes, the content stays
  await confirm(page, 'Reset progress', 'Yes, reset progress');
  const reset = await saved(page);
  ok(reset.score === 0 && reset.practised === 0, 'reset: no points, no word practised');
  ok(reset.words === 6 && JSON.stringify(reset.order) === JSON.stringify(start.order), 'reset: the 6 words and the level list stay');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  ok(JSON.stringify(await saved(page)) === JSON.stringify(reset), 'reset: the same after a reload');

  // Delete everything (Admin -> Import & export): the content and the progress go
  await withProgress(page);
  await page.goto(APP + '/admin/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  ok((await saved(page)).score === 80, 'progress again before deleting');
  await confirm(page, 'Delete everything', 'Yes, delete everything');
  const wiped = await saved(page);
  ok(wiped.words === 0 && wiped.order.length === 0, 'delete everything: no words, no levels: ' + JSON.stringify(wiped));
  ok(wiped.score === 0 && wiped.practised === 0, 'delete everything: no progress');
  await page.screenshot({ path: `${SP}/shot-startover.png`, fullPage: true });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  ok(JSON.stringify(await saved(page)) === JSON.stringify(wiped), 'delete everything: the same after a reload');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

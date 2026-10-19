// Saving the shared content in a real browser (local mode, the local player is the admin), with made-up content
// (fixtures/content-admin.json): a fresh game offers to bring a copy in; an import is saved; a content change is
// saved; when a save fails (the browser refuses to store the content) the warning says so and nothing is lost: the
// next change saves both changes; everything is the same after a reload, and the fresh-copy offer is gone.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');

const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); };
  open.onerror = () => resolve(null);
}), key);
const saved = async (page) => {
  const c = await idbGet(page, 'local:content');
  return { words: (c?.words || []).length, order: c?.levelOrder || [] };
};
// The browser refuses (or allows again) to store the content key, as a full or blocked storage would.
const blockContentWrites = (page, on) => page.evaluate((block) => {
  if (!window.__realPut) window.__realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = block
    ? function (value, key) { if (key === 'local:content') throw new DOMException('Blocked for the test', 'QuotaExceededError'); return window.__realPut.call(this, value, key); }
    : window.__realPut;
}, on);
const dialog = (page) => page.locator('[role="alertdialog"]');
const addCategory = async (page, name) => {
  await page.click('button:has-text("New category")');
  await dialog(page).locator('input').fill(name);
  await dialog(page).locator('button:has-text("Add")').click(); await page.waitForTimeout(1200);
};
const warning = async (page) => { const el = page.locator('.wh-storage-warning'); return (await el.count()) ? (await el.textContent()) || '' : ''; };

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  ok(await page.locator('text=Open Import & Export').isVisible(), 'a fresh game offers to bring a copy in');
  ok((await saved(page)).words === 0, 'no words yet (the admin\'s game saves its empty content once after the load)');
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(1500);
  const imported = await saved(page);
  ok(imported.words === 6 && JSON.stringify(imported.order) === JSON.stringify(['Weather', 'Climate', 'Hotel']), 'the import is saved: ' + JSON.stringify(imported));

  // a change is saved
  await page.goto(APP + '/admin/categories', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  await addCategory(page, 'Spare');
  ok(JSON.stringify((await saved(page)).order) === JSON.stringify(['Weather', 'Climate', 'Hotel', 'Spare']), 'a new category is saved');

  // a failed save: the warning says so, the saved content is still the last good one
  await blockContentWrites(page, true);
  await addCategory(page, 'Extra');
  ok(/Content could not be saved to the server/.test(await warning(page)), 'a failed save shows the warning: ' + (await warning(page)).slice(0, 70));
  ok(!(await saved(page)).order.includes('Extra'), 'the refused change is not in storage');

  // the next change saves everything, both changes
  await blockContentWrites(page, false);
  await addCategory(page, 'Third');
  const after = await saved(page);
  ok(JSON.stringify(after.order) === JSON.stringify(['Weather', 'Climate', 'Hotel', 'Spare', 'Extra', 'Third']) && after.words === 6, 'the next change saves both changes: ' + after.order.join(', '));
  await page.screenshot({ path: `${SP}/shot-contentsave.png`, fullPage: true });

  // after a reload: the same content, and no fresh-copy offer
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  ok(JSON.stringify(await saved(page)) === JSON.stringify(after), 'the same after a reload');
  ok(!(await page.locator('text=Open Import & Export').count()), 'the fresh-copy offer is gone once there is content');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

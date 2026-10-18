// The admin's category tools in a real browser (local mode, the local player is the admin), with made-up content
// (fixtures/content-admin.json): merging a category into another moves its words and its level progress and takes
// it out of the level list; deleting a category deletes its words; an empty category is removed by "Remove empty".
// Each result is read from what the game saved (IndexedDB) and again after a reload.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');

const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); };
  open.onerror = () => resolve(null);
}), key);
const saved = async (page) => {
  const content = await idbGet(page, 'local:content'), progress = await idbGet(page, 'local:progress');
  const words = (content?.words || []).map((w) => `${w.word}:${w.category}`).sort();
  return { words, order: content?.levelOrder || [], levelStats: progress?.levelStats || {} };
};
const dialog = (page) => page.locator('[role="alertdialog"]');

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(2000);

  // some level progress on "Weather", as a player would have after a round there
  await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('word-hunter', 1);
    open.onsuccess = () => {
      const store = open.result.transaction('kv', 'readwrite').objectStore('kv');
      const g = store.get('local:progress');
      g.onsuccess = () => { const cur = g.result || {}; store.put({ ...cur, levelStats: { ...(cur.levelStats || {}), 'cat-Weather': { attempts: 3, bestAccuracy: 80 } } }, 'local:progress').onsuccess = () => resolve(); };
    };
  }));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const before = await saved(page);
  ok(JSON.stringify(before.order) === JSON.stringify(['Weather', 'Climate', 'Hotel']), 'the made-up course has three categories: ' + before.order.join(', '));
  ok(before.levelStats['cat-Weather']?.attempts === 3, 'Weather has level progress');

  // merge Weather into Climate
  await page.goto(APP + '/admin/categories', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  await page.click('button[aria-label="Merge Weather"]');
  await dialog(page).locator('input').fill('Climate');
  await dialog(page).locator('button:has-text("Move")').click(); await page.waitForTimeout(1500);
  const merged = await saved(page);
  ok(merged.words.filter((w) => w.endsWith(':Climate')).length === 4 && !merged.words.some((w) => w.endsWith(':Weather')), 'merge: the two Weather words are now in Climate: ' + merged.words.join(', '));
  ok(JSON.stringify(merged.order) === JSON.stringify(['Climate', 'Hotel']), 'merge: Weather is out of the level list: ' + merged.order.join(', '));
  ok(merged.levelStats['cat-Climate']?.attempts === 3 && !merged.levelStats['cat-Weather'], 'merge: the level progress moved to Climate');

  // delete Hotel (with its two words)
  await page.click('button[aria-label="Delete Hotel"]');
  await dialog(page).locator('input').fill('DELETE');
  await dialog(page).locator('button:has-text("Delete it and its 2 items")').click(); await page.waitForTimeout(1500);
  const deleted = await saved(page);
  ok(!deleted.words.some((w) => w.endsWith(':Hotel')) && deleted.words.length === 4, 'delete: the Hotel words are gone, the others stay: ' + deleted.words.join(', '));
  ok(JSON.stringify(deleted.order) === JSON.stringify(['Climate']), 'delete: Hotel is out of the level list');

  // an empty category, then "Remove empty"
  await page.click('button:has-text("New category")');
  await dialog(page).locator('input').fill('Spare');
  await dialog(page).locator('button:has-text("Add")').click(); await page.waitForTimeout(1200);
  ok(JSON.stringify((await saved(page)).order) === JSON.stringify(['Climate', 'Spare']), 'a new empty category is in the list');
  await page.click('button:has-text("Remove 1 empty")'); await page.waitForTimeout(1500);
  ok(JSON.stringify((await saved(page)).order) === JSON.stringify(['Climate']), '"Remove empty" took it out again');
  await page.screenshot({ path: `${SP}/shot-catadmin.png`, fullPage: true });

  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const reloaded = await saved(page);
  ok(JSON.stringify(reloaded) === JSON.stringify({ ...deleted, order: ['Climate'] }), 'the same after a reload');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

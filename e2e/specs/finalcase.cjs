// The Final Case in a real browser (local mode, made-up content from fixtures/content-admin.json): a level with a star
// offers "Final Case"; its recall round asks each word by typing; then the case report screen shows the recall score
// and the evidence words, ticks a word when the report uses it, and (local mode has no AI) shows the AI's failure
// without changing anything. Guards the live path next to the old round engine that was removed (MT-03).
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');
const ANSWERS = [['umbrella', 'Drizzle'], ['of wind blew', 'Gust']];

const idbPut = (page, key, patch) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const store = open.result.transaction('kv', 'readwrite').objectStore('kv'); const g = store.get(k); g.onsuccess = () => { store.put({ ...(g.result || {}), ...v }, k).onsuccess = () => resolve(); }; };
}), [key, patch]);
const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); };
}), key);

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(1500);
  await idbPut(page, 'local:progress', { levelsCleared: ['cat-Weather'] });
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);

  const finalButtons = page.locator('button:has-text("Final Case")');
  ok((await finalButtons.count()) >= 1, 'levels offer Final Case');
  const enabled = await finalButtons.evaluateAll((bs) => bs.map((b) => !b.disabled));
  ok(enabled.filter(Boolean).length === 1, 'only the level with a star can start it: ' + JSON.stringify(enabled));
  await finalButtons.nth(enabled.indexOf(true)).click(); await page.waitForTimeout(1200);

  // the recall round: type each word (2 Weather words), pressing on through any card in between
  let typed = 0;
  for (let i = 0; i < 20 && !(await page.locator('text=CASE REPORT').count()); i++) {
    const body = await page.innerText('body');
    const answer = ANSWERS.find(([clue]) => body.includes(clue));
    const input = page.locator('input[aria-label="Your answer"]');
    if (answer && (await input.count()) && !(await input.isDisabled().catch(() => true))) { await input.fill(answer[1]); await page.keyboard.press('Enter'); typed++; await page.waitForTimeout(600); }
    const next = page.locator('button:has-text("Next"):visible, button:has-text("Continue"):visible, button:has-text("Finish"):visible, button:has-text("Save results"):visible').first();
    if (await next.count()) await next.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  ok(typed === 2, `the recall round asked the two words by typing (${typed})`);
  ok(await page.locator('text=FINAL CASE — Weather').isVisible(), 'the case report screen opens for Weather');
  ok((await page.locator('.wh-results-score').textContent()).includes('2/2'), 'the recall score is 2/2: ' + await page.locator('.wh-results-score').textContent());
  const chips = (await page.locator('.wh-evidence-chip').allTextContents()).sort();
  ok(JSON.stringify(chips) === JSON.stringify(['Drizzle', 'Gust']), 'the evidence words: ' + chips.join(', '));
  ok(await page.locator('button:has-text("Submit Case Report")').isDisabled(), 'Submit waits for a report');

  await page.fill('.wh-case-report textarea', 'A light drizzle fell, then a gust of wind came.'); await page.waitForTimeout(200);
  ok((await page.locator('.wh-evidence-chip.used').count()) === 2, 'both words are ticked when the report uses them');
  const before = await idbGet(page, 'local:progress');
  await page.click('button:has-text("Submit Case Report")'); await page.waitForTimeout(1200);
  ok(/AI evaluation is unavailable/.test(await page.locator('.wh-case-report').innerText()), 'local mode: the AI failure is shown on the report');
  await page.screenshot({ path: `${SP}/shot-finalcase.png`, fullPage: true });
  const after = await idbGet(page, 'local:progress');
  ok(JSON.stringify(after?.mastery?.Drizzle?.modes?.finalReport || null) === JSON.stringify(before?.mastery?.Drizzle?.modes?.finalReport || null), 'a failed report changes no final-report mastery');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

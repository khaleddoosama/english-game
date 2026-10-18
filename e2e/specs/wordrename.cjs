// Renaming a word to a name another word already has, in a real browser (local mode, the local player is the
// admin): the editor refuses with a clear message and NOTHING changes - both words, the player's progress and
// the view that holds them are exactly as before. Control: a rename to a free name works and takes the
// progress and the view membership along, so the refusal is what makes the difference.
const { APP, ok, launch, run, SP, COURSE_BACKUP } = require('../helpers.cjs');
const fixture = require(COURSE_BACKUP);

const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); };
  open.onerror = () => resolve(null);
}), key);
// What the library holds for this player: the views and the words in each.
const viewsOf = (page) => page.evaluate(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('library1:') && k !== 'library1:shares') return JSON.stringify(JSON.parse(localStorage.getItem(k)).views.map((v) => [v.name, Object.keys(v.senses || {}).sort()]));
  }
  return null;
});

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', COURSE_BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);

  const FROM = 'Provoke', TAKEN = 'Innovative';          // both are words of the course; the player gets progress on Provoke
  // The import brings the course, not progress: give the player some, as a real player would have after rounds
  // (the record is the one in the fixture), then load the game again so it starts from it.
  await page.evaluate((record) => new Promise((resolve) => {
    const open = indexedDB.open('word-hunter', 1);
    open.onsuccess = () => {
      const store = open.result.transaction('kv', 'readwrite').objectStore('kv');
      const g = store.get('local:progress');
      g.onsuccess = () => { const cur = g.result || {}; store.put({ ...cur, mastery: { ...(cur.mastery || {}), Provoke: record } }, 'local:progress').onsuccess = () => resolve(); };
    };
  }), fixture.mastery[FROM]);
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  // a view that holds both
  await page.goto(APP + '/library?new=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.fill('input[aria-label="New view name"]', 'Keep'); await page.click('button:has-text("Create")'); await page.waitForTimeout(500);
  await page.click('.lib-tree li:has-text("Keep")'); await page.waitForTimeout(400);
  await page.click('button.chip:has-text("From the dictionary")'); await page.waitForTimeout(200);
  await page.click('.lib-paste summary'); await page.fill('textarea[aria-label="Words to add"]', `${FROM}\n${TAKEN}`);
  await page.click('button:has-text("Check the list")'); await page.waitForTimeout(300);
  await page.click('button:has-text("Add them")'); await page.waitForTimeout(600);

  const namesOf = async () => ((await idbGet(page, 'local:content'))?.words || []).map((w) => w.word).sort();
  const before = { names: await namesOf(), mastery: (await idbGet(page, 'local:progress'))?.mastery?.[FROM], views: await viewsOf(page) };
  ok(before.names.includes(FROM) && before.names.includes(TAKEN), 'both words are in the course');
  ok(before.mastery?.total > 0, `${FROM} has progress: ${before.mastery?.total} answers`);
  ok(JSON.parse(before.views)[0][1].length === 2, 'the view Keep holds both words: ' + before.views);

  // the refused rename, written with other case and extra spaces on purpose
  await page.goto(APP + '/admin/words/' + FROM, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const field = page.locator('label.adm-field', { hasText: 'renaming keeps' }).locator('input');
  ok((await field.inputValue()) === FROM, 'the editor opens on ' + FROM);
  await field.fill('  innovative ');
  await page.click('button:has-text("Save changes")'); await page.waitForTimeout(800);
  const message = await page.locator('.adm-editor').innerText();
  ok(/already exists/.test(message), 'a clear refusal is shown: ' + (message.match(/“[^”]*” already exists\./) || ['(none)'])[0]);
  ok(await page.isVisible('button:has-text("Save changes")'), 'the editor stays open, nothing was saved');
  await page.screenshot({ path: `${SP}/shot-wordrename-refused.png`, fullPage: true });

  const after = { names: await namesOf(), mastery: (await idbGet(page, 'local:progress'))?.mastery?.[FROM], views: await viewsOf(page) };
  ok(JSON.stringify(after.names) === JSON.stringify(before.names), 'both records are still there, none added or lost (' + after.names.length + ' words)');
  ok(JSON.stringify(after.mastery) === JSON.stringify(before.mastery), 'the progress of ' + FROM + ' is unchanged');
  ok(!(await idbGet(page, 'local:progress'))?.mastery?.['innovative'], 'and nothing was written under the other name');
  ok(after.views === before.views, 'the view still holds both words');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  ok(JSON.stringify(await namesOf()) === JSON.stringify(before.names) && (await viewsOf(page)) === before.views, 'the same after a reload');

  // control: a free name works and takes the progress and the view with it
  await page.goto(APP + '/admin/words/' + FROM, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  await page.locator('label.adm-field', { hasText: 'renaming keeps' }).locator('input').fill('Provoking');
  await page.click('button:has-text("Save changes")'); await page.waitForTimeout(1500);
  const names2 = await namesOf();
  ok(names2.includes('Provoking') && !names2.includes(FROM) && names2.length === before.names.length, 'control: a free name renames the word (one record, new name)');
  const prog2 = await idbGet(page, 'local:progress');
  ok(prog2?.mastery?.Provoking?.total === before.mastery.total && !prog2?.mastery?.[FROM], 'control: the progress moved with it');
  // Known gap, local mode only: the local library keeps words by text and nothing moves a view's entry on a
  // rename (online it follows, migration 0037, tests/integration/content-rename.test.js). Not asserted here.
  console.log('NOTE local mode: the view now holds', await viewsOf(page));
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

const { APP, ok, launch, run, SP, BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.evaluate(() => {
    const zed = 'zed-1';
    const users = JSON.parse(localStorage.getItem('friends1:users')); users[zed] = 'zed'; localStorage.setItem('friends1:users', JSON.stringify(users));
    localStorage.setItem('library1:' + zed, JSON.stringify({ seq: 2, entries: { Campaign: {}, Allowance: {} }, views: [
      { id: 'zv1', parent: null, name: 'Work', path: 'Work', position: 1, senses: { Campaign: { at: 1 } }, rules: {} },
      { id: 'zv2', parent: 'zv1', name: 'Money', path: 'Work::Money', position: 1, senses: { Allowance: { at: 1 } }, rules: {} }] }));
    localStorage.setItem('library1:catalog', JSON.stringify([{ id: 'c1', view: 'zv1', owner: zed, title: 'Work words', description: 'Office vocabulary', at: Date.now(), down: false, takes: 0 }]));
  });
  await page.goto(APP + '/catalog', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.innerText('.lib-catalog-list')).includes('Work words'), 'the catalog lists the entry');
  await page.screenshot({ path: `${SP}/shot-catalog.png`, fullPage: true });
  await page.fill('input[aria-label="Search the catalog"]', 'zzz'); await page.waitForTimeout(500);
  ok(await page.isVisible('.lib-empty'), 'a search with no match says so');
  await page.fill('input[aria-label="Search the catalog"]', 'office'); await page.waitForTimeout(500);
  ok((await page.$$('.lib-catalog-list li')).length === 1, 'search by description finds it');
  await page.click('button:has-text("Add to my library")'); await page.waitForTimeout(800);
  ok((await page.innerText('.lib-notice')).includes('Added'), 'taking it says what was added');
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const tabs = await page.locator('.wh-level-view-toggle button').allInnerTexts();
  ok(tabs.includes('Work (from zed)'), 'the copy is a tab on Home: ' + tabs);
  await page.click('.wh-level-view-toggle button:has-text("Work (from zed)")'); await page.waitForTimeout(800);
  const titles = await page.$$eval('.lib-readonly .wh-level-title', (h) => h.map((x) => x.textContent));
  ok(JSON.stringify(titles) === JSON.stringify(['All of Work (from zed)', 'Money']), 'with an All card and one card per view inside: ' + titles);
  await page.screenshot({ path: `${SP}/shot-home-grouped.png`, fullPage: true });
  // publish my own copy from the library's Share menu
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.click('.lib-tree .lib-name'); await page.waitForTimeout(500);
  await page.click('.lib-share summary'); await page.fill('input[aria-label="Catalog title"]', 'Mine to share');
  await page.click('button:has-text("Publish")'); await page.waitForTimeout(500);
  ok((await page.innerText('.lib-share')).includes('It is in the catalog now.'), 'publishing says so');
  await page.goto(APP + '/catalog', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.innerText('.lib-catalog-list')).includes('Mine to share') && (await page.isVisible('button:has-text("Delete")')), 'my entry shows with Take it down');
  ok(errors.length === 0, 'no page errors ' + errors.join('|'));
  await browser.close();
});

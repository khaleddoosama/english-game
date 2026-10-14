// Library vs views, picking words from my library, sharing by link, and opening a link.
const { APP, ok, launch, run, SP, BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP }).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const tabs = await page.locator('[role=tab]').allInnerTexts();
  ok(tabs.length === 2 && /Views/.test(tabs[0]) && /Library/.test(tabs[1]), 'two tabs: Views and Library ' + JSON.stringify(tabs));
  await page.click('[role=tab]:has-text("Library")');
  ok((await page.innerText('.lib-empty')).includes('no words yet'), 'the library starts empty with an explanation');
  await page.click('[role=tab]:has-text("Views")');
  await page.fill('input[aria-label="New view name"]', 'A1.1 sports'); await page.click('button:has-text("Create")'); await page.waitForTimeout(300);
  ok((await page.innerText('.lib-source .chip.on')).includes('From the dictionary'), 'with an empty library, words come from the dictionary');
  await page.fill('input[aria-label="Search words"]', 'a'); await page.waitForTimeout(300);
  const boxes = await page.$$('.lib-results input[type=checkbox]');
  for (let i = 0; i < 4; i++) await boxes[i].check();
  await page.click('button:has-text("selected")'); await page.waitForTimeout(400);
  // a word in the library that is in no view: add 1 to a second view then remove from the first
  await page.click('[role=tab]:has-text("Library")'); await page.waitForTimeout(300);
  ok((await page.innerText('.lib-summary')).includes('4 words in your library'), 'the Library tab counts the 4 words: ' + (await page.innerText('.lib-summary')));
  ok((await page.$$('.lib-results li')).length === 4, 'and lists them');
  const _first = await page.$eval('.lib-results li b', (e) => e.textContent);
  ok((await page.innerText('.lib-results li')).includes('in 1 view'), 'each says how many views it is in');
  await page.screenshot({ path: `${SP}/shot-lib-tab.png`, fullPage: true });
  // back in the view: adding now starts from my library
  await page.click('[role=tab]:has-text("Views")'); await page.waitForTimeout(300);
  if (!(await page.$('.lib-panel'))) { await page.click('.lib-tree .lib-name'); await page.waitForTimeout(200); }
  ok((await page.innerText('.lib-source .chip.on')).includes('From my library (4)'), 'adding to a view starts from my library');
  // share by link
  await page.click('.lib-share summary'); await page.waitForTimeout(400);
  await page.click('button:has-text("Get a link")'); await page.waitForTimeout(300);
  const url = await page.inputValue('input[aria-label="Link to this view"]');
  console.log('link:', url);
  ok(/\/join\/[a-z0-9]{20,}$/.test(url), 'a link is shown');
  await page.screenshot({ path: `${SP}/shot-lib-link.png`, fullPage: true });
  const _token = url.split('/join/')[1];
  // my own link
  await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.innerText('body')).includes('This is your own view'), 'opening my own link says it is my own view');
  // a link from someone else (seeded): zed's view
  const _myId = await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('friends1:users')) return Object.keys(JSON.parse(localStorage.getItem(k)))[0]; } return null; });
  await page.evaluate(() => {
    const users = JSON.parse(localStorage.getItem('friends1:users') || '{}'); users['zed-1'] = 'zed'; localStorage.setItem('friends1:users', JSON.stringify(users));
    localStorage.setItem('library1:zed-1', JSON.stringify({ seq: 2, entries: { Campaign: {}, Allowance: {} }, views: [
      { id: 'zv1', parent: null, name: 'Work', path: 'Work', position: 1, senses: { Campaign: { at: 1 } }, rules: {} },
      { id: 'zv2', parent: 'zv1', name: 'Money', path: 'Work::Money', position: 1, senses: { Allowance: { at: 1 } }, rules: {} }] }));
    localStorage.setItem('library1:links', JSON.stringify([{ token: 'zedlinkzedlinkzedlinkzedlink', view: 'zv1', owner: 'zed-1', at: Date.now(), expires: Date.now() + 86400000, revoked: false, uses: 0 }]));
  });
  await page.goto(APP + '/join/zedlinkzedlinkzedlinkzedlink', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const body = await page.innerText('body');
  ok(body.includes('zed') && body.includes('Work') && body.includes('2 words'), 'a friend\'s link shows who and what: ' + body.replace(/\s+/g, ' ').slice(200, 380));
  await page.screenshot({ path: `${SP}/shot-join.png` });
  await page.click('button:has-text("Add to my library")'); await page.waitForTimeout(700);
  ok((await page.innerText('body')).includes('Added “Work (from zed)”'), 'taking it makes my copy');
  await page.click('button:has-text("Open my views")'); await page.waitForTimeout(800);
  ok(/\/$/.test(page.url().split('?')[0]) || page.url() === APP + '/', 'it opens home: ' + page.url());
  const active = await page.locator('.wh-level-view-toggle button[aria-pressed="true"]').allInnerTexts();
  ok(active[0] === 'Work (from zed)', 'the copy is its own tab: ' + active);
  ok((await page.innerText('.lib-readonly')).includes('Money'), 'the copy is there with its view inside');
  // the same link again
  await page.goto(APP + '/join/zedlinkzedlinkzedlinkzedlink', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.innerText('body')).includes('already have a copy'), 'opening it again says I already have it');
  await page.goto(APP + '/join/nonsense', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.innerText('body')).includes('isn’t right'), 'a wrong link says so');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

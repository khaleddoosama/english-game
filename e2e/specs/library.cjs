// My library in local mode: make views inside views, add words (search + pasted list), practise one, rename/move/remove.
const { APP, ok, launch, run, SP, BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);
  await page.goto(APP + '/profile', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('button:has-text("My library")');
  await page.waitForSelector('.lib');
  ok(await page.isVisible('.lib-empty'), 'empty library shows the explanation');
  // views inside views
  await page.fill('input[aria-label="New view name"]', 'A1.1'); await page.click('button:has-text("Create")'); await page.waitForTimeout(300);
  ok((await page.$$('.lib-tree > li')).length === 1, 'top view created');
  await page.fill('input[aria-label="New view inside"]', 'movies'); await page.click('.lib-panel button:has-text("Add")'); await page.waitForTimeout(300);
  ok((await page.$$('.lib-tree > li')).length === 2, 'view inside it created');
  console.log('path:', JSON.stringify(await page.innerText('.lib-path')));
  ok((await page.innerText('.lib-path')).includes('A1.1'), 'path shows A1.1 › movies');
  // add words by search
  await page.fill('input[aria-label="Search words"]', 'a'); await page.waitForTimeout(300);
  const boxes = await page.$$('.lib-results input[type=checkbox]');
  ok(boxes.length > 3, 'search finds words (' + boxes.length + ')');
  await boxes[0].check(); await boxes[1].check();
  await page.click('button:has-text("selected")'); await page.waitForTimeout(400);
  ok((await page.$$('.lib-chips li')).length === 2, 'two words in the view');
  // pasted list: one real word, one nonsense
  const first = await page.$eval('.lib-results li:nth-child(5) b', (e) => e.textContent);
  await page.click('.lib-paste summary');
  await page.fill('textarea[aria-label="Words to add"]', `${first}\nzzzz not a word`);
  await page.click('button:has-text("Check the list")');
  ok((await page.innerText('.lib-checked')).includes('1 not in the dictionary'), 'pasted list reports the missing word');
  await page.click('button:has-text("Add them")'); await page.waitForTimeout(400);
  ok((await page.$$('.lib-chips li')).length === 3, 'pasted word added');
  await page.screenshot({ path: `${SP}/shot-library.png`, fullPage: true });
  // practise the top view (deep): includes the movies words
  await page.click('.lib-tree li:first-child .lib-name'); await page.waitForTimeout(300);
  await page.click('.lib-tree li:first-child .lib-go'); await page.waitForTimeout(1500);
  ok(await page.isVisible('.wh-flashcard, .wh-session, [class*=session]'), 'a round starts from the view');
  await page.screenshot({ path: `${SP}/shot-library-practice.png` });
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.$$('.lib-tree > li')).length === 2, 'views are still there after a reload');
  // rename + move + remove
  await page.click('.lib-tree li:nth-child(2) .lib-name'); await page.waitForTimeout(200);
  await page.click('button:has-text("Rename")'); await page.fill('input[aria-label="New name"]', 'films'); await page.click('button:has-text("Save")'); await page.waitForTimeout(300);
  ok((await page.innerText('.lib-path')).includes('A1.1 › films'), 'renamed');
  await page.selectOption('select[aria-label="Move to"]', '__top'); await page.waitForTimeout(300);
  ok((await page.innerText('.lib-path')) === 'films', 'moved to the top level');
  const rm = page.locator('.lib-panel button:has-text("Remove")');
  await rm.click(); await page.locator('button:has-text("Tap again")').click(); await page.waitForTimeout(400);
  ok((await page.$$('.lib-tree > li')).length === 1, 'removed');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

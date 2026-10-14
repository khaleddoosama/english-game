// A view made from course level A1.1 holds only grammar rules (General Grammar): practising it is a grammar round.
const { APP, ok, launch, run, SP, FIXTURE } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE("general-grammar-word-hunter.json")); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const opts = await page.locator('select[aria-label="Start from a course level"] option').allInnerTexts();
  console.log('levels:', opts);
  ok(opts.some((o) => o.startsWith('A1.1')), 'course level A1.1 is offered');
  await page.selectOption('select[aria-label="Start from a course level"]', 'A1.1');
  await page.click('button:has-text("Make it")'); await page.waitForTimeout(800);
  ok((await page.innerText('.lib-tree')).includes('A1.1'), 'the view is made');
  ok((await page.innerText('.lib-tree')).includes('0 words'), 'it holds no words: ' + (await page.innerText('.lib-tree')).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${SP}/shot-library-desktop.png`, fullPage: true });
  await page.click('.lib-tree li:first-child .lib-go'); await page.waitForTimeout(1500);
  const body = await page.innerText('body');
  ok(!/No safe questions/i.test(body), 'not an empty round');
  ok(await page.isVisible('.wh-option, .wh-options, [class*=option]'), 'a grammar question is shown');
  console.log(body.replace(/\s+/g, ' ').slice(0, 300));
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

const { APP, ok, launch, run } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const tabs = await page.locator('.wh-level-view-toggle button').allInnerTexts();
  console.log(tabs);
  ok(tabs.includes('Catalog'), 'a player with no views still has a Catalog button in the tab strip');
  await page.click('.lib-catalog-tab'); await page.waitForTimeout(600);
  ok(page.url().endsWith('/catalog'), 'it opens the catalog');
  await page.goto(APP + '/profile', { waitUntil: 'networkidle' });
  ok(await page.isVisible('button:has-text("Catalog")'), 'Profile has a Catalog row');
  ok(errors.length === 0, 'no page errors ' + errors);
  await browser.close();
});

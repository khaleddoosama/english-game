const { APP, ok, launch, run, SP, COURSE_BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', COURSE_BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const tabs = await page.locator('.wh-level-view-toggle button').allInnerTexts();
  console.log('tabs:', tabs);
  ok(JSON.stringify(tabs) === JSON.stringify(['Gateway', 'By lesson', '+', 'Catalog']), 'the tabs: Gateway, By lesson, a + for a new view and Catalog (no My views, no By unit)');
  ok((await page.getAttribute('.wh-level-view-toggle button:has-text("By lesson")', 'aria-pressed')) === 'true', 'By lesson is the one open by default for a new player');
  await page.screenshot({ path: `${SP}/shot-home-gateway.png` });
  await page.click('.wh-level-view-toggle button:has-text("By lesson")'); await page.waitForTimeout(400);
  ok((await page.$$('.wh-level-card')).length > 0, 'By lesson shows lesson cards');
  const units = await page.$$('.wh-level-units');
  console.log('lessons with units:', units.length);
  if (units.length) {
    await units[0].evaluate((d) => (d.open = true)); await page.waitForTimeout(200);
    ok((await units[0].$$('li')).length > 0, 'a lesson lists its units with Practice buttons');
    await page.screenshot({ path: `${SP}/shot-home-lesson-units.png` });
    await units[0].$eval('li button', (b) => b.click()); await page.waitForTimeout(1500);
    ok(await page.isVisible('.wh-flashcard, .wh-session, [class*=session]'), 'Practice on a unit starts a round');
    await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  }
  ok(!(await page.$('.lib-head')), 'with no separate page header');
  await page.click('button[aria-label="New view"]'); await page.waitForTimeout(600);
  ok(page.url().endsWith('/library?new=1'), 'the + opens the library page ready to make a view');
  await page.fill('input[aria-label="New view name"]', 'Mine'); await page.click('button:has-text("Create")'); await page.waitForTimeout(400);
  ok((await page.$$('.lib-tree > li')).length === 1, 'a view can be made there');
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  ok((await page.locator('.wh-level-view-toggle button').allInnerTexts()).includes('Mine'), 'the new view is a tab named Mine');
  await page.click('.wh-level-view-toggle button:has-text("Mine")'); await page.waitForTimeout(600);
  ok((await page.$$('.lib-readonly .wh-level-card')).length === 1, 'and it shows on Home as a card');
  await page.screenshot({ path: `${SP}/shot-home-mine.png`, fullPage: true });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.getAttribute('.wh-level-view-toggle button:has-text("Mine")', 'aria-pressed')) === 'true', 'the chosen view is remembered after a refresh');
  // an old saved setting "group" (By unit) opens By lesson
  await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const v = localStorage.getItem(k); if (v && v.includes('"levelView"')) localStorage.setItem(k, v.replace(/"levelView":"[a-z]+"/, '"levelView":"group"')); } });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  console.log('after old setting:', await page.locator('.wh-level-view-toggle button[aria-pressed="true"]').allInnerTexts());
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

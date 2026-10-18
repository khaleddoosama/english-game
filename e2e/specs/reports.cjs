// Reporting a question and what the admin does with it, in a real browser (local mode, the local player is the admin):
// the Report button of a round files a report, the AI check is not available here (no AI server) and says so, and the
// admin's Reports page lists it, resolves it, reopens it and deletes it. The report is part of the saved progress.
const { APP, ok, launch, run, SP, COURSE_BACKUP } = require('../helpers.cjs');

const progress = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get('local:progress'); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); };
  open.onerror = () => resolve(null);
}));

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', COURSE_BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);

  // a round with one word (as in libsolo.cjs)
  await page.goto(APP + '/library?new=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.fill('input[aria-label="New view name"]', 'Solo'); await page.click('button:has-text("Create")'); await page.waitForTimeout(500);
  await page.click('.lib-tree li:has-text("Solo")'); await page.waitForTimeout(400);
  await page.click('button.chip:has-text("From the dictionary")'); await page.waitForTimeout(200);
  await page.click('.lib-paste summary'); await page.fill('textarea[aria-label="Words to add"]', 'Campaign');
  await page.click('button:has-text("Check the list")'); await page.waitForTimeout(300);
  await page.click('button:has-text("Add them")'); await page.waitForTimeout(600);
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.click('.wh-level-view-toggle button:has-text("Solo")'); await page.waitForTimeout(500);
  await page.locator('.lib-readonly .wh-level-card button.lib-go').first().click(); await page.waitForTimeout(1200);
  await page.click('.wh-flashcard-nav button:has-text("Continue")'); await page.waitForTimeout(800);
  ok(await page.isVisible('.wh-options'), 'a question is on the screen');
  const prompt = await page.innerText('.wh-sentence');

  // report it
  await page.click('button:has-text("Report question")'); await page.waitForTimeout(300);
  await page.click('button:has-text("Typo or grammar mistake")');
  await page.click('button:has-text("Submit report")'); await page.waitForTimeout(2500);
  const dialog = await page.innerText('[role=alertdialog]');
  ok(/Report saved/.test(dialog), 'the report is saved: ' + dialog.replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: `${SP}/shot-reports-filed.png` });
  await page.click('[role=alertdialog] button:has-text("Continue"), [role=alertdialog] button:has-text("Close and continue"), [role=alertdialog] button:has-text("Keep report")'); await page.waitForTimeout(300);
  await page.waitForTimeout(1500);
  const stored = (await progress(page))?.reports || [];
  console.log('reports in the saved progress:', stored.length);

  // the admin's page
  await page.goto(APP + '/admin/reports', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SP}/shot-reports-admin.png`, fullPage: true });
  const body = await page.innerText('body');
  ok(body.includes('Typo or grammar mistake') || body.includes(prompt.slice(0, 20)), 'the admin page lists the report');
  const count = async (name) => Number(((await page.innerText('body')).match(new RegExp(`${name}\\s+(\\d+)`)) || [])[1]);   // the cards above the table
  ok((await count('Open')) === 1 && (await count('Resolved')) === 0, 'one report is open, none resolved');
  await page.locator('td, [role=cell]').filter({ hasText: prompt.slice(0, 20) }).first().click();
  await page.waitForTimeout(600);
  ok(await page.isVisible('button:has-text("Resolve")'), 'its drawer opens with Resolve');
  await page.click('button:has-text("Resolve")'); await page.waitForTimeout(600);
  ok(await page.isVisible('button:has-text("Reopen")'), 'resolved: Reopen is offered');
  ok((await count('Open')) === 0 && (await count('Resolved')) === 1, 'the cards follow: none open, one resolved');
  await page.click('button:has-text("Reopen")'); await page.waitForTimeout(600);
  ok(await page.isVisible('button:has-text("Resolve")'), 'reopened: Resolve is offered again');
  ok((await count('Open')) === 1, 'and it is open again');
  await page.click('button.adm-btn.danger:has-text("Delete")'); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click(); await page.waitForTimeout(800);
  await page.screenshot({ path: `${SP}/shot-reports-deleted.png`, fullPage: true });
  ok((await count('Open')) === 0 && (await count('Resolved')) === 0, 'deleted: no report is left on the page');
  ok(((await progress(page))?.reports || []).length === 0, 'and none is left in the saved progress');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

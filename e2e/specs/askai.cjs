// The "Ask AI" drawer in a real browser (local mode, made-up content from fixtures/content-admin.json). Local mode has
// no AI, so this checks the wiring around the call: the header opens the drawer with the typed word and asks at once,
// the local-mode message is shown, Escape / a click outside / the close button close it, and the speaker opens the
// pronunciation window. What an answer does (stale answers, adding a word) is tested in tests/ask-ai-hook.test.jsx.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');

const drawer = (page) => page.locator('[role="dialog"][aria-label="Ask AI about a word"]');
const header = (page) => page.locator('.wh-ask-bar input[aria-label="Ask AI about a word"]');

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(1500);
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);

  // the header: type, then "Ask AI"
  await header(page).fill('  rain   cloud ');
  await page.click('.wh-ask-bar button[title="Ask AI"]'); await page.waitForTimeout(800);
  ok(await drawer(page).isVisible(), 'the drawer opens');
  ok((await drawer(page).locator('input').inputValue()) === 'rain cloud', 'it holds the word, trimmed, with single spaces');
  const message = await drawer(page).locator('.wh-import-error').textContent().catch(() => '');
  ok(/AI features need the online version/.test(message || ''), 'it asked at once; local mode says AI needs the online version: ' + message);
  ok(!(await drawer(page).locator('button:has-text("Investigating")').count()), 'not busy after the answer');

  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(!(await drawer(page).count()), 'Escape closes it');

  // Enter in the header opens it again; a click outside the card closes it
  await header(page).fill('drizzle');
  await header(page).press('Enter'); await page.waitForTimeout(800);
  ok(await drawer(page).isVisible(), 'Enter in the header opens it');
  await page.mouse.click(5, 450); await page.waitForTimeout(300);
  ok(!(await drawer(page).count()), 'a click outside the card closes it');

  // the close button
  await page.click('.wh-ask-bar button[title="Ask AI"]'); await page.waitForTimeout(600);
  await drawer(page).locator('button[aria-label="Close"]').click(); await page.waitForTimeout(300);
  ok(!(await drawer(page).count()), 'the close button closes it');

  // the speaker opens the pronunciation window for the typed word
  await page.click('.wh-ask-bar button[aria-label="Listen"]'); await page.waitForTimeout(600);
  ok(await page.locator('[role="dialog"][aria-label="Pronunciation of drizzle"]').isVisible(), 'the speaker opens the pronunciation window');
  await page.screenshot({ path: `${SP}/shot-askai.png`, fullPage: true });
  await page.locator('[role="dialog"][aria-label="Pronunciation of drizzle"] button[aria-label="Close"]').click(); await page.waitForTimeout(300);
  ok(!(await page.locator('[role="dialog"][aria-label="Pronunciation of drizzle"]').isVisible().catch(() => false)), 'and it closes');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

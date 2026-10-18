// The admin's story builder on /stories in a real browser (local mode, the local player is the admin), with made-up
// content (fixtures/content-admin.json: 2 words each in Weather, Climate and Hotel). Local mode has no AI, so this
// checks the wiring: the categories and their counts, the Generate button, the five-vocab rule (no AI call), the
// local-mode message when the AI is asked, and that a category change clears the message. What an answer does
// (stale answers, Add, Discard) is tested in tests/story-generation-hook.test.jsx.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');

const builder = (page) => page.locator('.wh-story-builder');
const tick = (page, name) => builder(page).locator(`label.wh-category-choice:has-text("${name}") input`).click();
const generate = (page) => builder(page).locator('button:has-text("Generate from")');
const status = async (page) => { const el = builder(page).locator('.wh-regen-status.error'); return (await el.count()) ? (await el.textContent()) || '' : ''; };

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(1500);
  await page.goto(APP + '/stories', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);

  const choices = (await builder(page).locator('label.wh-category-choice').allTextContents()).map((t) => t.trim());
  ok(JSON.stringify(choices) === JSON.stringify(['Weather2', 'Climate2', 'Hotel2']), 'the categories with a word, with their counts: ' + choices.join(' | '));
  ok(await generate(page).isDisabled(), 'Generate is disabled with no category');

  await tick(page, 'Weather'); await tick(page, 'Climate'); await page.waitForTimeout(200);
  ok((await generate(page).textContent()).includes('Generate from 2 categories'), 'two ticked: "Generate from 2 categories"');
  await generate(page).click(); await page.waitForTimeout(600);
  ok((await status(page)) === 'The selected categories need at least five vocab words in total.', 'four vocab words: the five-word rule, no AI call: ' + await status(page));

  await tick(page, 'Hotel'); await page.waitForTimeout(200);
  ok((await status(page)) === '', 'a category change clears the message');
  await generate(page).click(); await page.waitForTimeout(1200);
  ok(/AI features need the online version/.test(await status(page)), 'six vocab words: the AI is asked; local mode says it needs the online version: ' + await status(page));
  ok(await generate(page).isVisible(), 'the Generate button is back after the answer');
  ok(!(await page.locator('.wh-regen-preview').count()), 'no preview');
  await page.screenshot({ path: `${SP}/shot-storygen.png`, fullPage: true });

  await tick(page, 'Hotel'); await page.waitForTimeout(200);
  ok((await generate(page).textContent()).includes('Generate from 2 categories') && (await status(page)) === '', 'unticking clears the message again');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

// A view with ONE new word, in a real browser (local mode): the word is introduced, asked once with a
// valid question, and the answer is saved without mastering the word early. Then the tab is closed and
// opened again: the saved progress is still there. (Local mode keeps progress in this browser's IndexedDB;
// what this does NOT show is the Supabase save path - that is tests/integration/progress-ops.test.js.)
const { APP, ok, launch, run, SP, COURSE_BACKUP } = require('../helpers.cjs');

const readProgress = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => {
    const get = open.result.transaction('kv', 'readonly').objectStore('kv').get('local:progress');
    get.onsuccess = () => resolve(get.result || null);
    get.onerror = () => resolve(null);
  };
  open.onerror = () => resolve(null);
}));

run(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', COURSE_BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);

  const WORD = 'Campaign', MEANING = 'A planned series of actions to reach a goal.';
  const before = (await readProgress(page))?.mastery?.[WORD];
  ok(!before, `${WORD} is new to this player before the round`);

  // a view with that one word
  await page.goto(APP + '/library?new=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.fill('input[aria-label="New view name"]', 'Solo'); await page.click('button:has-text("Create")'); await page.waitForTimeout(500);
  await page.click('.lib-tree li:has-text("Solo")'); await page.waitForTimeout(400);
  await page.click('button.chip:has-text("From the dictionary")'); await page.waitForTimeout(200);
  await page.click('.lib-paste summary'); await page.fill('textarea[aria-label="Words to add"]', WORD);
  await page.click('button:has-text("Check the list")'); await page.waitForTimeout(300);
  await page.click('button:has-text("Add them")'); await page.waitForTimeout(600);
  await page.screenshot({ path: `${SP}/shot-libsolo-view.png`, fullPage: true });

  // practise it from Home
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.click('.wh-level-view-toggle button:has-text("Solo")'); await page.waitForTimeout(500);
  const go = page.locator('.lib-readonly .wh-level-card button.lib-go').first();
  ok(!(await go.isDisabled()), 'a view with one word can be practised');
  await go.click(); await page.waitForTimeout(1200);

  ok(await page.isVisible('.wh-flashcard'), 'the word is introduced first');
  ok((await page.innerText('.wh-flashcard-progress')).includes('Word 1 of 1'), 'as the only new word');
  ok((await page.innerText('.wh-flashcard')).includes(WORD), 'the card shows the word');
  await page.screenshot({ path: `${SP}/shot-libsolo-intro.png` });
  await page.click('.wh-flashcard-nav button:has-text("Continue")'); await page.waitForTimeout(800);

  // ... and then asked once, with a real question
  ok(await page.isVisible('.wh-options'), 'then it is asked: a question with options appears');
  ok(/1\s*\/\s*1/.test(await page.innerText('.wh-round-meta')), 'one question in the round: ' + (await page.innerText('.wh-round-meta')).replace(/\s+/g, ' '));
  const prompt = await page.innerText('.wh-sentence');
  const options = (await page.locator('.wh-option').allInnerTexts()).map((o) => o.replace(/^\d+/, '').trim());   // each option starts with its key number
  console.log('prompt:', prompt, '| options:', options.join(' / '));
  ok(options.length >= 2 && new Set(options.map((o) => o.toLowerCase())).size === options.length, 'at least two different options');
  const right = options.find((o) => o === WORD || o === MEANING);
  ok(!!right, 'the right answer is among the options');
  ok(!(prompt.includes(WORD) && options.some((o) => o === WORD)), 'the prompt does not give the answer away');
  await page.screenshot({ path: `${SP}/shot-libsolo-question.png` });
  await page.locator('.wh-option').filter({ hasText: right }).first().click(); await page.waitForTimeout(400);
  if (await page.isVisible('.wh-submit-btn')) { await page.click('.wh-submit-btn'); await page.waitForTimeout(400); }
  ok((await page.innerText('.wh-feedback')).startsWith('Correct'), 'the right answer is marked correct');
  await page.click('.wh-result-continue'); await page.waitForTimeout(1000);
  ok(await page.isVisible('text=Session complete'), 'the round ends after that one question');
  await page.click('button:has-text("Save results & review")'); await page.waitForTimeout(1500);

  // saved, and not mastered early
  const saved = (await readProgress(page))?.mastery?.[WORD];
  console.log('saved record:', JSON.stringify(saved));
  ok(saved && saved.total === 1 && saved.correct === 1, 'one answer, one right, is saved');
  ok(!saved?.mastered && (saved?.reviewStep || 0) <= 1, 'one right answer does not make it Mastered (review step ' + saved?.reviewStep + ')');
  ok((saved?.independentSessions || []).length === 1, 'it counts as one round (Mastered needs three)');
  await page.screenshot({ path: `${SP}/shot-libsolo-done.png`, fullPage: true });

  // the tab is closed and opened again: the progress is still there
  await page.close();
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  // On loading, the game fills in defaults (a review date of null for 0, zero sentence counters): compare what matters.
  const again = (await readProgress(page))?.mastery?.[WORD];
  const core = (r) => JSON.stringify([r?.introducedAt, r?.correct, r?.total, r?.reviewStep, r?.lastReviewedAt, r?.lastResult, r?.independentSessions, r?.appliedSessions, r?.modes]);
  ok(!!again && core(again) === core(saved), 'after closing the tab and opening it again, the same record is there (answers, step, round, time)');
  ok(!again?.everMastered, 'and it is still not Mastered');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

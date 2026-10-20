// A player's progress in the game screen, in a real browser (local mode, made-up content from
// fixtures/content-admin.json and made-up progress): saved progress is loaded into the header; an answer is saved
// about 600 ms later (not at once), and at once when the page is hidden (pagehide); the numbers an answer changes
// (score, streak, best streak, questions answered, the day's count) are what is saved; a badge earned now shows
// "New badge" once, a badge already earned when the game opens does not (no Final Case button and no weak-words review:
// both removed 2026-10-20); finishing a practice round (all answered
// right, the answers read from the round the game saved) records the study day
// (yesterday + today = one more day in a row); after a reload the same numbers come back.
// Reset and restore are in startover.cjs and importexport.cjs. Online saving (merging, conflicts, another device) is
// in tests/repo*.test.js and the hook tests. Docs: docs/modules/progress/progress-state.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');

const idbPut = (page, key, patch) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const store = open.result.transaction('kv', 'readwrite').objectStore('kv'); const g = store.get(k); g.onsuccess = () => { store.put({ ...(g.result || {}), ...v }, k).onsuccess = () => resolve(); }; };
}), [key, patch]);
const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); };
}), key);
const stat = async (page, title) => (await page.locator(`.wh-stats [title="${title}"]`).innerText()).replace(/\s+/g, '');
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
// Goes past the learning cards and a question's feedback to the next question; false when the round has ended.
async function toQuestion(page) {
  for (let i = 0; i < 40; i++) {
    if (await visible(page, 'h2:has-text("Session complete")')) return false;
    if (await visible(page, 'input[aria-label="Your answer"]:not([disabled])') || await visible(page, '.wh-option:not([disabled])')) return true;
    if (await visible(page, 'button:has-text("Next word →")')) await page.click('button:has-text("Next word →")');
    else if (await visible(page, 'button:has-text("Continue")')) await page.locator('button:has-text("Continue")').first().click();
    await page.waitForTimeout(200);
  }
  return false;
}
// Answers the question on screen right: its answer is read from the round the game saved (made-up content).
async function answerRight(page, question) {
  const input = page.locator('input[aria-label="Your answer"]');
  if (await input.count() && await input.isVisible()) { await input.fill(question.answers[0]); await page.keyboard.press('Enter'); return; }
  const texts = (await page.locator('.wh-option').allInnerTexts()).map((t) => t.replace(/^\d+/, '').trim());
  for (const a of question.answers) await page.locator('.wh-option').nth(texts.indexOf(a)).click();
  const submit = page.locator('button.wh-submit-btn:not([disabled])');
  if (await submit.count()) await submit.click();
}

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(1500);

  // made-up progress: one answer short of the 5-answer streak badge, studied yesterday (3 days in a row)
  const today = new Date(), yesterday = new Date(Date.now() - 86400000);
  await idbPut(page, 'local:progress', { score: 100, streak: 4, bestStreak: 4, attempted: 10, studyStreak: 3, bestStudyStreak: 5, lastStudyDate: dayKey(yesterday) });
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const header = [await stat(page, 'Score'), await stat(page, 'Answer streak'), await stat(page, 'Study streak (days in a row)')].join(' / ');
  ok(header === '100pts / 4 / 3dstreak', 'the saved progress is loaded into the header: ' + header);
  ok(!(await page.locator('.wh-toast').count()), 'no toast when the game opens');
  ok(!(await page.locator('button:has-text("Final Case")').count()), 'the lessons offer no Final Case (removed 2026-10-20)');

  // a practice round of the Weather lesson: the questions and their answers are read from the saved round
  await page.locator('.wh-level-card:has-text("Weather") button:has-text("Practice")').first().click(); await page.waitForTimeout(1200);
  const queue = (await idbGet(page, 'local:progress')).activeSession.queue;
  ok(await toQuestion(page), `the round asks ${queue.length} questions`);
  await answerRight(page, queue[0]);
  await page.waitForTimeout(150);
  const early = await idbGet(page, 'local:progress');
  ok(early.score === 100 && early.attempted === 10, `not saved at once (after 150 ms the saved score is still ${early.score})`);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(150);
  const flushed = await idbGet(page, 'local:progress');
  ok(flushed.score === 110 && flushed.attempted === 11 && flushed.streak === 5 && flushed.bestStreak === 5, `hiding the page saves at once: score ${flushed.score}, answered ${flushed.attempted}, streak ${flushed.streak}, best ${flushed.bestStreak}`);
  ok(flushed.dailyProgress?.answered === 1 && flushed.dailyProgress?.correct === 1 && flushed.dailyProgress?.date === dayKey(today), 'the day\'s count is saved: ' + JSON.stringify(flushed.dailyProgress));
  await page.waitForSelector('.wh-toast', { timeout: 3000 });
  ok(/New badge:\s*Warming Up/.test(await page.innerText('.wh-toast')), 'the 5-answer streak shows "New badge: Warming Up"');

  // the other questions, right, then the round's end: the study day is recorded
  for (let i = 1; await toQuestion(page); i++) { await answerRight(page, queue[i]); await page.waitForTimeout(300); }
  ok(await visible(page, 'h2:has-text("Session complete")'), 'the round ends');
  await page.click('button:has-text("Save results & review")');
  await page.waitForTimeout(1200);
  const saved = await idbGet(page, 'local:progress');
  ok(saved.score === 100 + 10 * queue.length && saved.streak === 4 + queue.length && saved.bestStreak === 4 + queue.length && saved.attempted === 10 + queue.length, `every answer is saved after the delay: score ${saved.score}, streak ${saved.streak} (${queue.length} right)`);
  ok(saved.studyStreak === 4 && saved.bestStudyStreak === 5 && saved.lastStudyDate === dayKey(today), `the study day: ${saved.studyStreak} days in a row, best ${saved.bestStudyStreak}, last ${saved.lastStudyDate}`);
  ok(saved.mastery?.Drizzle?.total >= 1 && saved.mastery?.Gust?.total >= 1 && (saved.completedSessions || []).length === 1, 'the round\'s answers are in the words\' records, and the round is marked done');
  ok(saved.schemaVersion >= 1 && saved.settings && typeof saved.settings === 'object', 'the save carries the progress version and the settings');

  // reload: the same numbers, and no toast for the badge earned before
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const after = [await stat(page, 'Score'), await stat(page, 'Answer streak'), await stat(page, 'Study streak (days in a row)')].join(' / ');
  ok(after === `${100 + 10 * queue.length}pts / ${4 + queue.length} / 4dstreak`, 'after a reload the header shows the saved numbers: ' + after);
  ok(!(await page.locator('.wh-toast').count()), 'a badge earned before the game opened shows no toast');
  // a word mixed up three times is a weak word
  await idbPut(page, 'local:progress', { confusions: { 'Drizzle|Gust': { count: 3, lastAt: Date.now() } } });
  await page.goto(APP + '/stats', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  ok(/Needs work/.test(await page.innerText('body')) && !(await page.locator('.sd-card button:has-text("Review")').count()), 'the stats page lists the words that need work, with no weak-words review (removed 2026-10-20)');
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok(/1\s*\/\s*\d+/.test(await page.locator('.wh-stats button[title="View badges"]').innerText()), 'the badge count includes it: ' + await page.locator('.wh-stats button[title="View badges"]').innerText());
  await page.screenshot({ path: `${SP}/shot-progress.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
});

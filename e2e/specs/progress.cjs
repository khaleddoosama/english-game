// A player's progress in the game screen, in a real browser (local mode, made-up content from
// fixtures/content-admin.json and made-up progress): saved progress is loaded into the header; an answer is saved
// about 600 ms later (not at once), and at once when the page is hidden (pagehide); the numbers an answer changes
// (score, streak, best streak, questions answered, the day's count) are what is saved; a badge earned now shows
// "New badge" once, a badge already earned when the game opens does not; finishing a round records the study day
// (yesterday + today = one more day in a row); after a reload the same numbers come back.
// Reset and restore are in startover.cjs and importexport.cjs. Online saving (merging, conflicts, another device) is
// in tests/repo*.test.js and the hook tests. Docs: docs/modules/progress/progress-state.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');
const ANSWERS = [['umbrella', 'Drizzle'], ['of wind blew', 'Gust']];

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

// Types the answer to the question on screen, if it is one of ours; returns whether it did.
async function answerTyped(page) {
  const body = await page.innerText('body');
  const answer = ANSWERS.find(([clue]) => body.includes(clue));
  const input = page.locator('input[aria-label="Your answer"]');
  if (!answer || !(await input.count()) || await input.isDisabled().catch(() => true)) return false;
  await input.fill(answer[1]); await page.keyboard.press('Enter');
  return true;
}
const next = (page) => page.locator('button:has-text("Next"):visible, button:has-text("Continue"):visible, button:has-text("Finish"):visible, button:has-text("Save results"):visible').first();

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
  await idbPut(page, 'local:progress', { levelsCleared: ['cat-Weather'], score: 100, streak: 4, bestStreak: 4, attempted: 10, studyStreak: 3, bestStudyStreak: 5, lastStudyDate: dayKey(yesterday) });
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const header = [await stat(page, 'Score'), await stat(page, 'Answer streak'), await stat(page, 'Study streak (days in a row)')].join(' / ');
  ok(header === '100pts / 4 / 3dstreak', 'the saved progress is loaded into the header: ' + header);
  ok(!(await page.locator('.wh-toast').count()), 'no toast when the game opens');

  // the Final Case of Weather: type the first answer
  const finalButtons = page.locator('button:has-text("Final Case")');
  const enabled = await finalButtons.evaluateAll((bs) => bs.map((b) => !b.disabled));
  await finalButtons.nth(enabled.indexOf(true)).click(); await page.waitForTimeout(1200);
  let typed = false;
  for (let i = 0; i < 10 && !typed; i++) { typed = await answerTyped(page); if (!typed) { if (await next(page).count()) await next(page).click().catch(() => {}); await page.waitForTimeout(400); } }
  ok(typed, 'the first word is answered by typing');
  await page.waitForTimeout(150);
  const early = await idbGet(page, 'local:progress');
  ok(early.score === 100 && early.attempted === 10, `not saved at once (after 150 ms the saved score is still ${early.score})`);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(150);
  const flushed = await idbGet(page, 'local:progress');
  ok(flushed.score === 110 && flushed.attempted === 11 && flushed.streak === 5 && flushed.bestStreak === 5, `hiding the page saves at once: score ${flushed.score}, answered ${flushed.attempted}, streak ${flushed.streak}, best ${flushed.bestStreak}`);
  ok(flushed.dailyProgress?.answered === 1 && flushed.dailyProgress?.correct === 1 && flushed.dailyProgress?.date === dayKey(today), 'the day\'s count is saved: ' + JSON.stringify(flushed.dailyProgress));
  await page.waitForSelector('.wh-toast', { timeout: 3000 });
  ok(/New badge:\s*Warming Up/.test(await page.innerText('.wh-toast')), 'the 5-answer streak shows "New badge: Warming Up"');

  // the second word, then the round's end: the study day is recorded
  for (let i = 0; i < 20 && !(await page.locator('text=CASE REPORT').count()); i++) {
    if (await answerTyped(page)) await page.waitForTimeout(600);
    if (await next(page).count()) await next(page).click().catch(() => {});
    await page.waitForTimeout(400);
  }
  ok(await page.locator('text=CASE REPORT').count() > 0, 'the round ends on the case report');
  await page.waitForTimeout(1200);
  const saved = await idbGet(page, 'local:progress');
  ok(saved.score === 120 && saved.streak === 6 && saved.bestStreak === 6 && saved.attempted === 12, `both answers are saved after the delay: score ${saved.score}, streak ${saved.streak}`);
  ok(saved.studyStreak === 4 && saved.bestStudyStreak === 5 && saved.lastStudyDate === dayKey(today), `the study day: ${saved.studyStreak} days in a row, best ${saved.bestStudyStreak}, last ${saved.lastStudyDate}`);
  ok(saved.mastery?.Drizzle?.total >= 1 && saved.mastery?.Gust?.total >= 1 && (saved.completedSessions || []).length === 1, 'the round\'s answers are in the words\' records, and the round is marked done');
  ok(saved.schemaVersion >= 1 && saved.settings && typeof saved.settings === 'object', 'the save carries the progress version and the settings');

  // reload: the same numbers, and no toast for the badge earned before
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const after = [await stat(page, 'Score'), await stat(page, 'Answer streak'), await stat(page, 'Study streak (days in a row)')].join(' / ');
  ok(after === '120pts / 6 / 4dstreak', 'after a reload the header shows the saved numbers: ' + after);
  ok(!(await page.locator('.wh-toast').count()), 'a badge earned before the game opened shows no toast');
  ok(/1\s*\/\s*\d+/.test(await page.locator('.wh-stats button[title="View badges"]').innerText()), 'the badge count includes it: ' + await page.locator('.wh-stats button[title="View badges"]').innerText());
  await page.screenshot({ path: `${SP}/shot-progress.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
});

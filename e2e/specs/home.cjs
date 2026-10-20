// Home, in a real browser (local mode, the local player is the admin; made-up words, stories and progress): the
// fresh-copy notice and Dismiss; the admin's announcement (its tone, hidden per message, a new message shows again);
// the Practice / Stories sections; today's goal (count, accuracy, reached, bonus); the stories list (fewest new words
// first, solved with its best result, "Play again" or "Open story", the new-word note); the Speed Round card's best;
// the Live card; Resume. Starting rounds is in practice.cjs, the view tabs in homeviews.cjs.
// Docs: docs/modules/practice/home.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');

const W = (word, category) => ({ word, type: 'vocab', category, meaning: `The meaning of ${word}.`, situation: `We talked about the ${word} today.`, gap: 'We talked about the ______ today.' });
const WORDS = ['Drizzle', 'Gust', 'Breeze', 'Thunder', 'Hail', 'Frost'].map((w) => W(w, 'Weather'));
const Q = (w) => ({ mode: 'mcq', targetWord: w, prompt: `Which word is ${w}?`, explanation: `It is ${w}.` });
const STORIES = [
  { id: 'story-new', title: 'A Stormy Night', sourceCategories: ['Weather'], text: 'Thunder and hail.', targetWords: ['Thunder', 'Hail', 'Frost'], questions: [Q('Thunder'), Q('Hail'), Q('Frost')] },
  { id: 'story-known', title: 'A Rainy Walk', sourceCategories: ['Weather'], text: 'Drizzle and gust.', targetWords: ['Drizzle', 'Gust'], questions: [Q('Drizzle'), Q('Gust')], grammarQuestions: [{ id: 'g1', mode: 'grammarCourt', type: 'mcq', prompt: 'It ______ raining.', answers: ['is'], targets: [], options: ['is', 'are'] }] },
];
const SAVED = { note: 'Made-up content for the Home spec.', combos: [], challenges: [], grammar: [], stories: STORIES, words: WORDS, levelOrder: ['Weather'] };
const known = { stage: 'Mastered', correct: 9, total: 9, reviewStep: 6, productionCorrect: 3, everMastered: true, streak: 5, lastSeen: Date.now() - 86400000, introducedAt: 1 };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const idb = (page, key, value) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const store = open.result.transaction('kv', 'readwrite').objectStore('kv'); (v === null ? store.delete(k) : store.put(v, k)).onsuccess = () => resolve(); };
}), [key, value]);
const text = async (page, sel) => ((await page.locator(sel).count()) ? (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim() : '');
const home = async (page) => { await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(900); };

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // a fresh copy (nothing saved): the notice, and Dismiss
  await home(page);
  ok(/Fresh copy detected/.test(await text(page, '.wh-fresh-copy-banner')), 'a fresh copy shows the notice about restoring a backup');
  await page.click('.wh-fresh-copy-banner button:has-text("Dismiss")');
  ok(!(await page.locator('.wh-fresh-copy-banner').count()), 'Dismiss hides it');

  // the admin's announcement: shown with its tone, hidden per message, a new message shows again
  await page.evaluate(() => localStorage.setItem('wh-app-settings', JSON.stringify({ announcement: 'Made-up notice: new lessons on Friday.', announcementTone: 'warning' })));
  await idb(page, 'local:content', SAVED);
  const today = dayKey(new Date());
  await idb(page, 'local:progress', { settings: { dailyGoal: 5, levelView: 'lesson' }, dailyProgress: { date: today, answered: 3, correct: 2 }, mastery: Object.fromEntries(['Drizzle', 'Gust', 'Breeze', 'Hail', 'Frost'].map((w) => [w, known])), bestSpeedScore: 40, bestSpeedCombo: 3, solvedStories: [{ id: 'story-known', correct: 2, total: 3 }] });
  await home(page);
  ok(await text(page, '.wh-announcement.warning') === 'Made-up notice: new lessons on Friday.', 'the announcement shows with its tone');
  await page.click('.wh-announcement button[aria-label="Hide this message"]');
  await home(page);
  ok(!(await page.locator('.wh-announcement').count()), 'a hidden announcement stays hidden after a reload');
  await page.evaluate(() => localStorage.setItem('wh-app-settings', JSON.stringify({ announcement: 'Another made-up notice.', announcementTone: 'info' })));
  await home(page);
  ok(await text(page, '.wh-announcement.info') === 'Another made-up notice.', 'a new message shows again');

  // today's goal
  ok(/Today's goal/.test(await text(page, '.wh-daily-goal')) && /3 \/ 5 questions · 67% correct/.test(await text(page, '.wh-daily-goal')), 'today\'s goal: ' + await text(page, '.wh-daily-goal'));
  await idb(page, 'local:progress', { settings: { dailyGoal: 5, levelView: 'lesson' }, dailyProgress: { date: today, answered: 7, correct: 7 }, mastery: Object.fromEntries(['Drizzle', 'Gust', 'Breeze', 'Hail', 'Frost'].map((w) => [w, known])), bestSpeedScore: 40, bestSpeedCombo: 3, solvedStories: [{ id: 'story-known', correct: 2, total: 3 }] });
  await home(page);
  const goal = await text(page, '.wh-daily-goal');
  ok(/Daily goal reached/.test(goal) && /7 \/ 5 questions · 100% correct/.test(goal) && /\+2 bonus questions today/.test(goal) && (await page.locator('.wh-daily-goal.done').count()) === 1, 'reached, with the bonus: ' + goal);

  // the Speed Round card's best, the Live card
  ok(/5 mastered words in the pool · best 40 pts, x3 combo/.test(await text(page, '.wh-speed-card:not(.wh-live-card)')), 'the Speed Round card: ' + await text(page, '.wh-speed-card:not(.wh-live-card)'));
  ok(/Live Challenge/.test(await text(page, '.wh-live-card')), 'the Live card is there');
  await page.click('.wh-live-card button:has-text("Play")'); await page.waitForTimeout(600);
  ok(new URL(page.url()).pathname === '/live', 'its Play opens Live: ' + page.url());

  // Stories: fewest new words first; solved with its best; the new-word note
  await home(page);
  await page.click('nav.wh-v2-nav button:has-text("Stories")'); await page.waitForTimeout(400);
  ok(await page.locator('nav.wh-v2-nav button:has-text("Stories")').getAttribute('aria-pressed') === 'true' && !(await page.locator('.wh-daily-goal').count()), 'the Stories section, without the goal: ' + new URL(page.url()).pathname);
  const stories = (await page.locator('article.wh-v2-learn').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  ok(stories.length === 2 && /^A Rainy Walk/.test(stories[0]) && /^A Stormy Night/.test(stories[1]), 'fewest new words first: ' + stories.map((s) => s.split(' ').slice(0, 3).join(' ')).join(' | '));
  ok(/Solved · 2\/3/.test(stories[0]) && /2 \+ 1 grammar questions · Ready for review/.test(stories[0]) && /Play again/.test(stories[0]), 'a solved story: ' + stories[0]);
  ok(/3 questions · 1 new words: preview first/.test(stories[1]) && /Open story/.test(stories[1]) && !/Solved/.test(stories[1]), 'a story with new words: ' + stories[1]);
  await page.click('nav.wh-v2-nav button:has-text("Practice")'); await page.waitForTimeout(400);
  ok(await page.locator('.wh-daily-goal').count() === 1, 'back to Practice');

  // Resume
  await page.locator('.wh-level-card:has(.wh-level-title:text-is("Weather")) > button.wh-level-btn').click(); await page.waitForTimeout(800);
  await page.click('button:has-text("Save and leave")'); await page.waitForTimeout(600);
  ok(/^Resume Weather \(1\/\d+\)$/.test(await text(page, 'button:has-text("Resume")')), 'Resume names the round and where it is: ' + await text(page, 'button:has-text("Resume")'));
  await page.screenshot({ path: `${SP}/shot-home.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
});

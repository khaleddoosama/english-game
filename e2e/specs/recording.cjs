// What a round records, in a real browser (local mode, made-up content from fixtures/content-admin.json and made-up
// progress): a practice round of one lesson is played to the end (first option, or "-" for "I don't know"), then its
// results are saved. Read back from what the game saved: every answer counts once in the day's count and in the
// questions answered; the score grows 10 per right answer; the round log, the day's history, the lesson's stats and
// (at 70% or more) its star; the round is marked done and the game goes back Home; the new words are marked
// introduced and have records; wrong word choices are noted as confusions with the right word; the daily goal shows
// its message. Counting a round once, read sentences and stories are in tests/answer-recording.test.jsx. Then a Speed Round of mastered words: its best score and
// combo are kept. Docs: docs/modules/progress/answer-recording.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');
const WEATHER = ['Drizzle', 'Gust'];

const idbPut = (page, key, patch) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const store = open.result.transaction('kv', 'readwrite').objectStore('kv'); const g = store.get(k); g.onsuccess = () => { store.put({ ...(g.result || {}), ...v }, k).onsuccess = () => resolve(); }; };
}), [key, patch]);
const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); };
}), key);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const mastered = { stage: 'Mastered', correct: 9, total: 9, reviewStep: 6, productionCorrect: 3, everMastered: true, streak: 5, lastSeen: Date.now() - 86400000 };

// Plays the round on screen to its end: learning cards, then each question (first option, or "-" when typed).
// Returns how many questions were answered, how many actions timed out, and the texts of any toast seen.
// Untimed rounds: every action must work; any error fails the spec. Timed rounds (the Speed Round): the time can run
// out between finding a control and using it, so an action waits at most 3 s, and a Playwright TimeoutError is
// tolerated only if the round's end screen (`endSel`) is showing when it happens (counted in `missed`); a timeout
// while the round still runs, or any other error, fails the spec.
async function playRound(page, endSel, { timed = false } = {}) {
  let answered = 0, missed = 0; const toasts = new Set();
  const act = (promise) => promise.then(() => true, async (e) => {
    if (timed && e?.name === 'TimeoutError' && await visible(page, endSel)) { missed++; return false; }
    throw e;
  });
  for (let i = 0; i < 200 && !(await visible(page, endSel)); i++) {
    if (await visible(page, '.wh-toast')) toasts.add((await page.innerText('.wh-toast')).replace(/\s+/g, ' ').trim());
    if (await visible(page, 'button:has-text("Next word →")')) { await act(page.click('button:has-text("Next word →")', { timeout: 3000 })); continue; }
    const input = page.locator('input[aria-label="Your answer"]');
    if (await input.count() && !(await input.isDisabled())) {
      if (await act(input.fill('-', { timeout: 3000 })) && await act(input.press('Enter', { timeout: 3000 }))) answered++;
      await page.waitForTimeout(250); continue;
    }
    const option = page.locator('.wh-option:not([disabled])').first();
    if (await option.count() && await option.isVisible()) {
      if (!(await act(option.click({ timeout: 3000 })))) continue;
      await page.waitForTimeout(100);
      const submit = page.locator('button.wh-submit-btn:not([disabled])');
      if (await submit.count() && !(await act(submit.click({ timeout: 3000 })))) continue;
      answered++; await page.waitForTimeout(250); continue;
    }
    if (await visible(page, 'button:has-text("Continue")')) { await act(page.locator('button:has-text("Continue")').first().click({ timeout: 3000 })); await page.waitForTimeout(200); continue; }
    await page.waitForTimeout(250);
  }
  if (await visible(page, '.wh-toast')) toasts.add((await page.innerText('.wh-toast')).replace(/\s+/g, ' ').trim());
  return { answered, missed, toasts: [...toasts] };
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
  const today = dayKey(new Date());
  // made-up progress: 4 questions today with a goal of 5, some points, no words learned yet
  await idbPut(page, 'local:progress', { score: 50, attempted: 20, streak: 0, bestStreak: 3, dailyProgress: { date: today, answered: 4, correct: 2 }, settings: { dailyGoal: 5, questionsPerRound: 8, newWordsPerRound: 3 } });
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);

  // a practice round of the Weather lesson
  await page.locator('.wh-level-card:has-text("Weather") button:has-text("Practice"), .wh-level:has-text("Weather") button:has-text("Practice")').first().click(); await page.waitForTimeout(1000);
  const { answered, toasts } = await playRound(page, 'h2:has-text("Session complete")');  // untimed: no error is tolerated
  const scoreText = await page.innerText('.wh-session-score');
  const [, right, total] = /(\d+) \/ (\d+) correct/.exec(scoreText) || [];
  ok(answered > 0 && Number(total) === answered, `the round asked ${total} questions and all were answered (${answered})`);
  ok(toasts.some((t) => /Daily goal reached: 5 questions today/.test(t)), 'the daily goal message shows: ' + toasts.join(' | '));
  await page.click('button:has-text("Save results & review")'); await page.waitForTimeout(1200);

  const p = await idbGet(page, 'local:progress');
  const n = Number(total), r = Number(right);
  ok(p.dailyProgress.answered === 4 + n && p.dailyProgress.correct === 2 + r && p.attempted === 20 + n, `each answer counts once: today ${p.dailyProgress.answered}/${p.dailyProgress.correct}, answered ${p.attempted}`);
  ok(p.score === 50 + 10 * r, `10 points per right answer: ${p.score} after ${r} right`);
  const log = p.sessionLogs?.[0];
  ok(log && log.kind === 'practice' && log.title === 'Weather' && log.correct === r && log.total === n && p.sessionLogs.length === 1, 'the round log: ' + JSON.stringify(log));
  ok(p.dailyHistory?.[today]?.rounds >= 1 || JSON.stringify(p.dailyHistory || {}).includes(today), 'the day\'s history has the round: ' + JSON.stringify(p.dailyHistory));
  const accuracy = (r / n) * 100;
  ok(p.levelStats?.['cat-Weather'] && (accuracy >= 70) === (p.levelsCleared || []).includes('cat-Weather'), `the lesson's stats; a star only at 70% or more (${Math.round(accuracy)}%): ` + JSON.stringify(p.levelStats?.['cat-Weather']));
  ok((p.completedSessions || []).length === 1 && p.activeSession?.completed === true && p.activeSession.id === p.completedSessions[0], 'the round is marked done');
  ok(WEATHER.every((w) => p.mastery?.[w]?.introducedAt > 0), 'the new words are marked introduced');
  ok(Object.keys(p.mastery || {}).some((w) => p.mastery[w].total > 0), 'the answers are in the words\' records');
  const pairs = Object.keys(p.confusions || {});
  ok(pairs.every((k) => WEATHER.includes(k.split('|')[0]) && k.split('|')[0] !== k.split('|')[1]), 'confusions pair a lesson word with another word: ' + pairs.join(', '));
  ok(p.studyStreak === 1 && p.lastStudyDate === today, 'the study day is recorded');

  ok(new URL(page.url()).pathname === '/', 'a saved round goes back Home: ' + page.url());

  // a Speed Round of 5 mastered words: the best score and combo are kept
  const fiveMastered = Object.fromEntries(['Drizzle', 'Gust', 'Humid', 'Arid', 'Concierge'].map((w) => [w, { ...mastered, introducedAt: 1 }]));
  await idbPut(page, 'local:progress', { mastery: fiveMastered, bestSpeedScore: 0, bestSpeedCombo: 0, activeSession: null, settings: { ...p.settings, speedSeconds: 30 } });
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  await page.click('button.wh-speed-card-btn'); await page.waitForTimeout(800);
  const speed = await playRound(page, '.wh-results-score:has-text("points")', { timed: true });
  const shown = /(\d+) points .* best combo x(\d+)/.exec((await page.innerText('.wh-results-score')).replace(/\s+/g, ' ')) || [];
  await page.waitForTimeout(1200);
  const s = await idbGet(page, 'local:progress');
  ok(speed.answered > 0 && s.bestSpeedScore === Number(shown[1]) && s.bestSpeedCombo === Number(shown[2]), `the Speed Round's best is kept: ${s.bestSpeedScore} points, combo x${s.bestSpeedCombo} (shown ${shown[1]}, x${shown[2]}; ${speed.answered} answered, ${speed.missed} actions timed out as the round ended)`);
  ok((s.completedSessions || []).some((id) => /^speed-/.test(id)) && !s.activeSession, 'the Speed Round is marked done and closed');
  await page.screenshot({ path: `${SP}/shot-recording.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
});

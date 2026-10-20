// Starting rounds, in a real browser (local mode, the local player is the admin; made-up words stored as a saved copy):
// a lesson, one of its units, a course level from Gateway, the new-word count after a strong and after a weak round
// (with its message), a story, the Speed Round (locked under 5 mastered words; then a timed round of mastered words
// with the time from Settings), and Resume. Each round is read from what the game saved (the open session).
// Answering and recording are in progress.cjs and recording.cjs; practice from a view in library.cjs.
// Docs: docs/modules/practice/starting-rounds.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');

const W = (word, category, extra = {}) => ({ word, type: 'vocab', category, meaning: `The meaning of ${word}.`, situation: `We talked about the ${word} today.`, gap: `We talked about the ______ today.`, ...extra });
const WEATHER = ['Drizzle', 'Gust', 'Breeze', 'Thunder', 'Hail', 'Frost', 'Mist', 'Sleet'];
const HOTEL = ['Lobby', 'Suite', 'Porter', 'Vacancy'];
const WORDS = [
  ...WEATHER.map((w, i) => W(w, 'Weather', { level: 'A1.2', ...(i < 3 ? { units: ['Unit-1'] } : {}) })),
  ...HOTEL.map((w) => W(w, 'Hotel', { level: 'A1.3' })),
];
const STORY = { id: 'story-rain', title: 'A Rainy Walk', category: 'Weather', sourceCategories: ['Weather'], text: 'A light drizzle fell, then a gust blew.', targetWords: ['Drizzle', 'Gust'],
  questions: [{ mode: 'mcq', targetWord: 'Drizzle', prompt: 'What fell first on the walk?', explanation: 'A light drizzle fell first.' }, { mode: 'mcq', targetWord: 'Gust', prompt: 'What blew next?', explanation: 'Then a gust blew.' }] };
const SAVED = { note: 'Made-up content for the practice spec.', combos: [], challenges: [], grammar: [], stories: [STORY], words: WORDS, levelOrder: ['Weather', 'Hotel'] };
const mastered = { stage: 'Mastered', correct: 9, total: 9, reviewStep: 6, productionCorrect: 3, everMastered: true, streak: 5, lastSeen: Date.now() - 86400000, introducedAt: 1 };

const idb = (page, key, value) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => {
    const store = open.result.transaction('kv', v === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    if (v === undefined) { const g = store.get(k); g.onsuccess = () => resolve(g.result || null); }
    else store.put(v, k).onsuccess = () => resolve();
  };
}), [key, value]);
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const session = async (page) => { await page.waitForTimeout(900); return (await idb(page, 'local:progress'))?.activeSession; };
const targets = (s) => [...new Set(s.queue.flatMap((q) => q.targets || []))];
const intros = (s) => (s.introductions || []).map((w) => w.word || w);
async function home(page, progress) {
  if (progress) await idb(page, 'local:progress', progress);
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
}
const lessonCard = (page, title) => page.locator(`.wh-level-card:has(.wh-level-title:text-is("${title}"))`);

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  await idb(page, 'local:content', SAVED);
  const base = { settings: { questionsPerRound: 6, newWordsPerRound: 3, levelView: 'lesson', speedSeconds: 45 } };

  // a lesson: only its words; the new words are introduced first
  await home(page, base);
  await lessonCard(page, 'Weather').locator('> button.wh-level-btn').click();
  let s = await session(page);
  ok(s && s.kind === 'practice' && s.title === 'Weather' && new URL(page.url()).pathname === '/play', `a lesson starts a practice round titled with the lesson, on /play: ${s?.kind} "${s?.title}"`);
  ok(targets(s).length > 0 && targets(s).every((w) => WEATHER.includes(w)), 'its questions are about the lesson\'s words: ' + targets(s).join(', '));
  ok(intros(s).length === 3 && intros(s).every((w) => WEATHER.includes(w)), 'three new words are introduced (Settings: 3): ' + intros(s).join(', '));

  // Save and leave, then Resume the same round
  await page.click('button:has-text("Save and leave")'); await page.waitForTimeout(600);
  ok(await visible(page, `button:has-text("Resume Weather")`), 'Home offers to resume it');
  await page.click('button:has-text("Resume Weather")'); await page.waitForTimeout(600);
  ok((await session(page)).id === s.id && new URL(page.url()).pathname === '/play', 'Resume opens the same round');

  // one unit of the lesson
  await home(page, base);
  await lessonCard(page, 'Weather').locator('details.wh-level-units summary').click();
  await lessonCard(page, 'Weather').locator('details.wh-level-units button:has-text("Practice")').first().click();
  s = await session(page);
  ok(s.title === 'Weather · Unit 1' && targets(s).every((w) => WEATHER.slice(0, 3).includes(w)), `a unit: "${s.title}", only its words: ${targets(s).join(', ')}`);

  // a course level from Gateway (the admin's view)
  await home(page, { ...base, settings: { ...base.settings, levelView: 'course' } });
  await page.locator('.wh-level-card:has(.wh-level-title:text-is("A1.3")) button').first().click();
  s = await session(page);
  ok(s.title === 'A1.3' && targets(s).length > 0 && targets(s).every((w) => HOTEL.includes(w)), `a course level: "${s.title}", only its words: ${targets(s).join(', ')}`);

  // new words after a strong round here (90% or more): two more, with a message; after a weak one (under 60%): two fewer
  const log = (correct) => ({ sessionLogs: [{ id: 'old-1', kind: 'practice', title: 'Weather', correct, total: 10, at: Date.now() - 3600000 }] });
  await home(page, { ...base, ...log(10) });
  await lessonCard(page, 'Weather').locator('> button.wh-level-btn').click();
  const toast = await page.locator('.wh-toast').innerText({ timeout: 3000 }).catch(() => '');
  s = await session(page);
  ok(intros(s).length === 5 && /Strong last round here — 5 new words this time/.test(toast), `after a strong round: ${intros(s).length} new words, "${toast.replace(/\s+/g, ' ').trim()}"`);
  await home(page, { ...base, ...log(5) });
  await lessonCard(page, 'Weather').locator('> button.wh-level-btn').click();
  s = await session(page);
  ok(intros(s).length === 1, `after a weak round: ${intros(s).length} new word`);

  // a story
  await home(page, base);
  await page.click('nav.wh-v2-nav button:has-text("Stories")'); await page.waitForTimeout(400);
  await page.locator('article.wh-v2-learn:has-text("A Rainy Walk") button').first().click();
  s = await session(page);
  ok(s && s.kind === 'story' && s.sourceStoryId === 'story-rain', `a story starts its round: ${s?.kind} ${s?.sourceStoryId}`);

  // the Speed Round: locked under 5 mastered words, then a timed round of mastered words
  const four = Object.fromEntries(WEATHER.slice(0, 4).map((w) => [w, mastered]));
  await home(page, { ...base, mastery: four });
  ok(await page.locator('button.wh-speed-card-btn').first().isDisabled() && /Master 1 more word to unlock/.test(await page.locator('.wh-speed-card').first().innerText()), 'the Speed Round is locked with 4 mastered words: ' + (await page.locator('.wh-speed-card').first().innerText()).replace(/\s+/g, ' '));
  const five = Object.fromEntries([...WEATHER.slice(0, 4), 'Lobby'].map((w) => [w, mastered]));
  await home(page, { ...base, mastery: five });
  ok(/5 mastered words in the pool/.test(await page.locator('.wh-speed-card').first().innerText()), 'with 5 it opens');
  const started = Date.now();
  await page.locator('button.wh-speed-card-btn').first().click();
  s = await session(page);
  const asked = [...new Set(s.queue.flatMap((q) => q.answers || []))];
  ok(s.kind === 'speed' && s.title === 'Speed Round' && s.seconds === 45 && Math.abs(s.deadline - started - 45000) < 5000, `a timed round: ${s.kind}, ${s.seconds} s`);
  ok(s.queue.length > 0 && asked.every((w) => Object.keys(five).includes(w)), 'its questions are about mastered words: ' + asked.join(', '));
  ok(s.queue.every((q, i) => i === 0 || (q.answers || [])[0] !== (s.queue[i - 1].answers || [])[0]), 'never the same word twice in a row');
  await page.screenshot({ path: `${SP}/shot-practice.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
});

// A whole Live challenge room in a real browser, local mode, two tabs of one browser (two made-up players, made-up
// words stored as a saved copy): joining from the link, the host seeing the guest arrive, starting together, the
// questions one at a time, the other player's progress in the race, a reload in the middle that continues at the
// next question, waiting for the last player, the results, a rematch offered to the other player, removing a player,
// leaving, and cancelling. Signals go through BroadcastChannel here; online they come from Supabase Realtime (not run
// here). Docs: docs/modules/live/challenge-room.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');

const W = (word) => ({ word, type: 'vocab', category: 'Weather', meaning: `The meaning of ${word}.`, situation: `We saw the ${word} today.`, gap: 'We saw the ______ today.' });
const WORDS = ['Drizzle', 'Downpour', 'Gust', 'Breeze', 'Thunder', 'Hail', 'Frost', 'Mist', 'Sleet', 'Fog'].map(W);
const SAVED = { note: 'Made-up content for the Live room spec.', combos: [], stories: [], challenges: [], grammar: [], words: WORDS, levelOrder: ['Weather'] };

const store = (page, value) => page.evaluate((v) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const t = open.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'local:content'); t.oncomplete = resolve; };
}), value);
const text = async (page, sel) => ((await page.locator(sel).count()) ? (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim() : '');
const questionNo = async (page) => (/Question (\d+)\/(\d+)/.exec(await text(page, '.lv-qtop')) || [])[1];
// Answers the question on screen (the first option) and waits for the next one, or for the end of the run.
async function answer(page) {
  const before = await questionNo(page);
  await page.locator('.wh-option').first().click();
  await page.waitForFunction((b) => { const t = document.querySelector('.lv-qtop')?.textContent || ''; return !t.includes(`Question ${b}/`) || !document.querySelector('.lv-play'); }, before, { timeout: 15000 });
  await page.waitForTimeout(200);
}
async function createChallenge(page, questions = '3') {
  await page.click('button:has-text("Create a challenge")'); await page.waitForSelector('.lv-form');
  await page.click(`.lv-seg[aria-label="Questions"] button:text-is("5")`);
  await page.click('.lv-seg[aria-label="Time per question"] button:text-is("No limit")');
  await page.fill('.lv-field:has-text("Name") input', `Room test ${questions}`);
  await page.click('button:has-text("Create and get the link")');
  await page.waitForSelector('.lv-lobby .lv-code', { timeout: 15000 });
  return (await page.innerText('.lv-lobby .lv-code')).trim();
}

run(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const errors = [];
  const watch = (p, tag) => p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  const A = await ctx.newPage(); watch(A, 'A');
  await A.goto(APP, { waitUntil: 'networkidle' }); await A.waitForTimeout(500);
  await store(A, SAVED);
  await A.goto(APP + '/live', { waitUntil: 'networkidle' }); await A.waitForSelector('.lv-you b');
  const nameA = (await A.innerText('.lv-you b')).trim();

  // A makes a challenge; B opens its link
  const code = await createChallenge(A, '1');
  ok(/^[A-Z0-9]{6}$/.test(code) && /Waiting for someone to join/.test(await text(A, '.lv-lobby')), `the host waits in the lobby (${code}); Start needs a second player`);
  const B = await ctx.newPage(); watch(B, 'B');
  await B.goto(`${APP}/live/${code}`, { waitUntil: 'networkidle' }); await B.waitForSelector('.lv-invite', { timeout: 15000 });
  ok(/invited you to play/.test(await text(B, '.lv-invite')) && /Join the challenge/.test(await text(B, '.lv-invite')), 'the link opens the invitation');
  await B.click('button:has-text("Join the challenge")'); await B.waitForSelector('.lv-lobby', { timeout: 10000 });
  ok(new RegExp(`Waiting for ${nameA} to start`).test(await text(B, '.lv-lobby')), 'the guest waits for the host');
  const nameB = (await B.locator('.lv-people li:has(small:text-is("you")) b').innerText()).trim();
  await A.waitForSelector(`.lv-people b:text-is("${nameB}")`, { timeout: 10000 });
  ok(/Start for 2 players/.test(await text(A, '.lv-lobby')), 'the host sees the guest arrive without reloading, and can start');

  // starting together: a countdown, then the first question, on both tabs
  await A.click('button:has-text("Start for 2 players")');
  await A.waitForSelector('.lv-countdown', { timeout: 10000 });
  await B.waitForSelector('.lv-countdown', { timeout: 10000 });
  ok(true, 'both get the countdown when the host starts');
  await A.waitForSelector('.lv-play', { timeout: 10000 }); await B.waitForSelector('.lv-play', { timeout: 10000 });
  ok(await questionNo(A) === '1' && await questionNo(B) === '1' && /Question 1\/5/.test(await text(A, '.lv-qtop')), 'then question 1 of 5 on both');

  // B answers two; A sees it in the race
  await answer(B); await answer(B);
  ok(await questionNo(B) === '3', 'questions come one at a time, in order');
  await A.waitForFunction((n) => [...document.querySelectorAll('.lv-race li')].some((li) => li.textContent.includes(n) && !/0 ✓/.test(li.textContent) || li.textContent.includes(n) && li.querySelector('.lv-race-bar i')?.style.width === '40%'), nameB, { timeout: 15000 });
  ok(true, 'the host\'s race shows the guest\'s progress');

  // a reload in the middle continues at the next question
  await answer(A); await answer(A);
  await A.reload({ waitUntil: 'networkidle' }); await A.waitForSelector('.lv-play', { timeout: 15000 });
  ok(await questionNo(A) === '3', 'after a reload the host continues at question 3: ' + await questionNo(A));

  // B finishes first and waits; then A finishes
  for (let i = 0; i < 3; i++) await answer(B);
  await B.waitForSelector('text=You finished!', { timeout: 10000 });
  ok(/Waiting for 1 player to finish/.test(await text(B, '.lv-center')), 'the first to finish waits for the other');
  await A.waitForFunction((n) => [...document.querySelectorAll('.lv-race li')].some((li) => li.textContent.includes(n) && li.querySelector('.lv-ok')), nameB, { timeout: 15000 });
  ok(true, 'the host\'s race marks the guest as finished');
  for (let i = 0; i < 3; i++) await answer(A);
  await A.waitForSelector('.lv-results', { timeout: 15000 }); await B.waitForSelector('.lv-results', { timeout: 25000 });
  const rows = await A.locator('.lv-table tbody tr').allInnerTexts();
  ok(rows.length === 2 && rows.some((r) => r.includes(nameA) && /made the questions/.test(r)) && rows.some((r) => r.includes(nameB)), 'both see the results; the host is marked as the questions\' maker: ' + rows.join(' | '));
  ok(/Retry challenge/.test(await text(A, '.lv-results')), 'the results offer a retry');
  await A.screenshot({ path: `${SP}/shot-liveroom-results.png`, fullPage: true });

  // a rematch: A retries; B is offered the new challenge
  await A.click('button:has-text("Retry challenge")'); await A.waitForSelector('.lv-form');
  ok(/Retry challenge/.test(await text(A, '.lv-form')), 'the retry opens the form with the same settings');
  await A.click('button:has-text("Create and get the link")'); await A.waitForSelector('.lv-lobby .lv-code', { timeout: 15000 });
  const next = (await A.innerText('.lv-lobby .lv-code')).trim();
  await B.waitForSelector('button:has-text("Join the new challenge")', { timeout: 20000 });
  ok(new RegExp(`${nameA}\\s+made a new challenge`).test(await text(B, '.lv-results')), 'the other player is offered the rematch');
  await B.click('button:has-text("Join the new challenge")'); await B.waitForSelector('.lv-lobby', { timeout: 10000 });
  ok(new URL(B.url()).pathname === `/live/${next}`, 'joining it opens the new lobby: ' + new URL(B.url()).pathname);

  // the host removes a player who has not started; the player sees the invitation again
  await A.waitForSelector(`button[aria-label="Remove ${nameB}"]`, { timeout: 10000 });
  await A.click(`button[aria-label="Remove ${nameB}"]`);
  await B.waitForSelector('.lv-invite', { timeout: 25000 });
  ok(/Join the challenge/.test(await text(B, '.lv-invite')) && !(await A.locator(`.lv-people b:text-is("${nameB}")`).count()), 'a removed player is out, and sees the invitation again');

  // leaving before the start; the host cancelling
  await B.click('button:has-text("Join the challenge")'); await B.waitForSelector('.lv-lobby', { timeout: 10000 });
  await A.waitForSelector(`.lv-people b:text-is("${nameB}")`, { timeout: 10000 });
  await B.click('.lv-lobby button:has-text("Leave")'); await B.waitForSelector('.lv-hero', { timeout: 10000 });
  await A.waitForFunction((n) => ![...document.querySelectorAll('.lv-people b')].some((b) => b.textContent === n), nameB, { timeout: 25000 });
  ok(true, 'a player who leaves before the start is gone from the host\'s lobby');
  await A.click('button:has-text("Cancel challenge")'); await A.waitForSelector('.lv-hero', { timeout: 10000 });
  await B.goto(`${APP}/live/${next}`, { waitUntil: 'networkidle' }); await B.waitForTimeout(1500);
  ok(/Challenge not available/.test(await text(B, 'main, body')), 'a cancelled challenge is not available');

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

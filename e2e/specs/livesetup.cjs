// Who plays Live and what they may create, in a real browser. Local mode (made-up words stored as a saved copy): each
// tab is its own player, kept across a reload; the create form's limits for the admin, the app's defaults and the
// player's own settings. Online, with the fake Supabase of e2e/fakeSupabase.cjs (made-up accounts and words): a
// player held to the admin's limits (creating off, at most 4 players, links up to 6 hours, defaults), and the admin
// not held to them. NOT proven: the database's own limits (supabase/tests/live_challenges.sql).
// Docs: docs/modules/live/live-setup.md.
const path = require('node:path');
const { ok, launch, run, OUT, APP: LOCAL } = require('../helpers.cjs');
const { createFakeSupabase, submitLogin } = require('../fakeSupabase.cjs');

const fake = createFakeSupabase();
const { APP, state } = fake;
const DIST = path.join(OUT, 'online-app-livesetup');

const W = (word, category) => ({ word, type: 'vocab', category, meaning: `The meaning of ${word}.`, situation: `We saw the ${word} today.`, gap: 'We saw the ______ today.' });
const WORDS = ['Drizzle', 'Downpour', 'Gust', 'Breeze', 'Thunder', 'Hail', 'Frost', 'Mist'].map((w) => W(w, 'Weather'));
const SAVED = { note: 'Made-up content for the Live setup spec.', combos: [], stories: [], challenges: [], grammar: [], words: WORDS, levelOrder: ['Weather'] };
state.content = { levelOrder: ['Weather'], words: WORDS, grammar: [] };

const store = (page, value) => page.evaluate((v) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const t = open.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'local:content'); t.oncomplete = resolve; };
}), value);
const text = async (loc) => ((await loc.count()) ? (await loc.first().innerText()).replace(/\s+/g, ' ').trim() : '');
const playingAs = (page) => text(page.locator('.lv-you b'));
const tabId = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('wh-live-player') || 'null')?.id);
const goLive = async (page) => { await page.click('nav.ui-bottom-nav button:has-text("Live")'); await page.waitForSelector('.lv-hero', { timeout: 20000 }); await page.waitForTimeout(300); };
// The create form as one line: players (max/value), link hours (options, chosen), questions and time chosen.
async function form(page) {
  await page.click('button:has-text("Create a challenge")'); await page.waitForSelector('.lv-form', { timeout: 10000 });
  const slider = page.locator('input[aria-label="Maximum players"]');
  const chosen = async (label) => text(page.locator(`[role="radiogroup"][aria-label="${label}"] [aria-checked="true"]`));
  const hours = await page.locator('[role="radiogroup"][aria-label="The link works for"] button').allInnerTexts();
  const out = { players: `${await slider.getAttribute('max')}/${await slider.inputValue()}`, hours: `${hours.join(',')}=${await chosen('The link works for')}`, count: await chosen('Questions'), seconds: await chosen('Time per question'), summary: await text(page.locator('.lv-summary')) };
  await page.click('.lv-form button:has-text("Cancel")'); await page.waitForTimeout(200);
  return out;
}
const hero = async (page) => (/up to (\d+)/.exec(await text(page.locator('.lv-hero p'))) || [])[1];

run(async () => {
  await fake.build(DIST);
  const browser = await launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // local mode: a player per tab
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); watch(page);
  await page.goto(LOCAL, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await store(page, SAVED);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await goLive(page);
  const me = await playingAs(page), id = await tabId(page);
  ok(/^Player \d\d$/.test(me) && /^tab-[a-z0-9]{6}$/.test(id), `local mode: the tab plays as a made-up player: ${me} (${id})`);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.lv-hero', { timeout: 20000 });
  ok(await playingAs(page) === me && await tabId(page) === id, 'a reload keeps the player');
  const other = await ctx.newPage(); watch(other);
  await other.goto(LOCAL + '/live', { waitUntil: 'networkidle' }); await other.waitForSelector('.lv-hero', { timeout: 20000 });
  ok(/^tab-/.test(await tabId(other)) && await tabId(other) !== id, 'another tab is another player: ' + await playingAs(other));
  await other.close();

  // local mode is the admin: no limits; the app's defaults
  ok(await hero(page) === '10', 'local admin: up to 10 players');
  const admin = await form(page);
  ok(admin.players === '10/10' && admin.hours === '1 hour,6 hours,1 day,3 days,7 days=1 day' && admin.count === '10' && admin.seconds === '20s', 'local admin: 2–10 players (10), links up to 7 days (1 day), 10 questions, 20s: ' + JSON.stringify(admin));

  // the app's defaults: 45s is offered; 12 questions is not, so nothing is marked but 12 are asked for
  await page.evaluate(() => localStorage.setItem('wh-app-settings', JSON.stringify({ liveDefaultQuestions: 12, liveDefaultSeconds: 45 })));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.lv-hero', { timeout: 20000 });
  const appDefaults = await form(page);
  ok(appDefaults.seconds === '45s' && appDefaults.count === '' && / 12 questions /.test(appDefaults.summary), 'the app\'s defaults; 12 questions is not a choice, so none is marked, yet 12 are asked for: ' + JSON.stringify(appDefaults));

  // the player's own settings win over the app's
  await page.goto(LOCAL + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.click('[role="radiogroup"][aria-label="Challenge questions"] button:text-is("15")');
  await page.click('[role="radiogroup"][aria-label="Challenge time"] button:text-is("30s")'); await page.waitForTimeout(300);
  await goLive(page);
  const own = await form(page);
  ok(own.count === '15' && own.seconds === '30s', 'the player\'s own settings: ' + JSON.stringify(own));
  await page.evaluate(() => localStorage.removeItem('wh-app-settings'));

  // online: a player held to the admin's limits
  const open = async () => {
    const c = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    await fake.serve(c, DIST);
    const p = await c.newPage(); watch(p);
    await p.goto(APP + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
    return p;
  };
  state.settings = { liveCreate: 'admin' };
  const closed = await open();
  await submitLogin(closed, 'sam_01', 'secret1'); await closed.waitForTimeout(800);
  await goLive(closed);
  ok(await text(closed.locator('.lv-tile.primary .lv-note')) === 'Creating challenges is turned off right now. You can still join one.' && !(await closed.locator('button:has-text("Create a challenge")').count()), 'creating off: a player can only join');
  ok(await playingAs(closed) === 'sam_01', 'online: the player is the account: ' + await playingAs(closed));

  state.settings = { liveMaxPlayers: 4, liveMaxHours: 6, liveDefaultQuestions: 15, liveDefaultSeconds: 45 };
  const player = await open();
  await submitLogin(player, 'sam_01', 'secret1'); await player.waitForTimeout(800);
  await goLive(player);
  ok(await hero(player) === '4', 'a player: up to 4 players');
  const held = await form(player);
  ok(held.players === '4/4' && held.hours === '1 hour,6 hours=6 hours' && held.count === '15' && held.seconds === '45s', 'a player: 2–4 players, links up to 6 hours, the app\'s defaults: ' + JSON.stringify(held));

  const ada = await open();
  await submitLogin(ada, 'ada_admin', 'secret2'); await ada.waitForTimeout(800);
  await goLive(ada);
  const free = await form(ada);
  ok(await hero(ada) === '10' && free.players === '10/10' && free.hours === '1 hour,6 hours,1 day,3 days,7 days=1 day' && free.count === '15' && free.seconds === '45s', 'the admin is not held to the limits (the defaults still apply): ' + JSON.stringify(free));
  await ada.screenshot({ path: `${OUT}/shot-livesetup.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

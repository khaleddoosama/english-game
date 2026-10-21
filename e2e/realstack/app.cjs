// The game's screens against the real stack (CI job "realstack": Supabase's Postgres, GoTrue, PostgREST and Realtime,
// with every migration), in a real browser, with the app built for online mode and served by the gateway. Made-up
// accounts and words only. What it proves, read back from the database each time:
// - an account made on the sign-up screen (GoTrue, register_player) plays a round of a lesson in its library, and the
//   round's answers are saved (progress sections, mastery rows);
// - opened again on another device (a new browser profile), the game shows what the server has;
// - with the connection lost, the game says so and keeps playing; when it comes back, the answers reach the server;
// - with the page closed while offline, the answers kept on the device reach the server when the game opens again.
// NOT proven here: a real Supabase project, the Vercel functions (AI, speech), Storage. Docs: docs/integration-tests.md.
const { execFileSync } = require('node:child_process');
const { ok, launch, run } = require('../helpers.cjs');
const { submitLogin, header, settled } = require('../fakeSupabase.cjs');

const APP = process.env.REALSTACK_URL || 'http://127.0.0.1:54330';
const PGURL = process.env.REALSTACK_PGURL;
const sql = (text) => execFileSync('psql', [PGURL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim();
const json = (text) => JSON.parse(sql(`select coalesce(to_jsonb(q), 'null') from (${text}) q`) || 'null');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000, step = 500) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(step)) { const v = await fn(); if (v) return v; }
  return fn();
}

const tag = `ui${Date.now().toString(36).slice(-5)}`;
const WORDS = ['Drizzle', 'Gust', 'Breeze', 'Thunder', 'Hail', 'Frost'];
const W = (word) => ({ word, type: 'vocab', category: 'Weather', meaning: `The meaning of ${word}.`, situation: `We talked about the ${word} today.`, gap: 'We talked about the ______ today.' });
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const syncText = async (page) => ((await page.locator('.ui-sync').count()) ? (await page.locator('.ui-sync').innerText()).trim() : '');
const coreOf = (id) => json(`select data from public.progress where user_id = '${id}' and section = 'core'`)?.data || {};

// Answers up to `max` questions of the open round (first option, or "-" when typed); stops at `endSel` if given.
async function answer(page, max, endSel) {
  let answered = 0;
  for (let i = 0; i < 200 && answered < max; i++) {
    if (endSel && await visible(page, endSel)) break;
    if (await visible(page, 'button:has-text("Next word →")')) { await page.click('button:has-text("Next word →")'); continue; }
    const input = page.locator('input[aria-label="Your answer"]');
    if (await input.count() && !(await input.isDisabled())) { await input.fill('-'); await input.press('Enter'); answered++; await page.waitForTimeout(300); continue; }
    const option = page.locator('.wh-option:not([disabled])').first();
    if (await option.count() && await option.isVisible()) {
      await option.click(); await page.waitForTimeout(100);
      const submit = page.locator('button.wh-submit-btn:not([disabled])');
      if (await submit.count()) await submit.click();
      answered++; await page.waitForTimeout(300); continue;
    }
    if (await visible(page, 'button:has-text("Continue")')) { await page.locator('button:has-text("Continue")').first().click(); await page.waitForTimeout(200); continue; }
    await page.waitForTimeout(250);
  }
  return answered;
}
// Opens the made-up lesson from Home; if it is not there, says what the page shows instead.
const openLesson = async (page) => {
  try {
    await page.locator('.wh-level-card:has(.wh-level-title:text-is("Weather")) > button.wh-level-btn').first().click({ timeout: 20000 });
  } catch (e) {
    const shown = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`the lesson is not on ${page.url()}: ${shown}`, { cause: e });
  }
  await page.waitForTimeout(800);
};
const signIn = async (page, username) => {
  await page.goto(APP + '/', { waitUntil: 'networkidle' }); await settled(page);
  await page.click('.auth-tabs [role="tab"]:has-text("Sign in")');
  await submitLogin(page, username, 'secret1'); await settled(page);
};

run(async () => {
  const stack = await import('../../tests/realstack/stack.js');
  // The admin publishes a made-up lesson (as the content screen does), and the library copy is made.
  const admin = await stack.signUp(`${tag}adm`);
  stack.promote(admin);
  const rows = WORDS.map((w, i) => ({ kind: 'words', key: w, data: W(w), position: (i + 1) * 1000 }));
  const pub = await admin.client.rpc('content_save_v2', { p_draft: null, p_upserts: rows, p_removes: [], p_level_order: ['Weather'], p_note: 'Made-up content for the real-stack screens spec.', p_renames: null, p_expected_version: null, p_publish: true });
  if (pub.error) throw new Error(`content_save_v2: ${pub.error.message}`);
  const sync = await admin.client.rpc('dictionary_sync');
  if (sync.error) throw new Error(`dictionary_sync: ${sync.error.message}`);

  const browser = await launch();
  const errors = [];
  const newPage = async (context) => { const p = await context.newPage(); p.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); return p; };
  const phone = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  let page = await newPage(phone);

  // 1. an account made on the sign-up screen
  const player = `${tag}pl`;
  await page.goto(APP + '/', { waitUntil: 'networkidle' }); await settled(page);
  await page.click('.auth-tabs [role="tab"]:has-text("Create account")');
  await submitLogin(page, player, 'secret1'); await settled(page);
  ok(new RegExp(`^Hi ${player} · `).test(await header(page)), 'an account made on the sign-up screen is signed in: ' + await header(page));
  const id = sql(`select id from public.profiles where username = '${player}'`);
  ok(/^[0-9a-f-]{36}$/.test(id), 'GoTrue and register_player made the player: ' + id);

  // The lesson's words join the player's library (the player's own call, as the library screen makes it).
  const { createClient } = await import('@supabase/supabase-js');
  const anon = process.env.REALSTACK_ANON;
  const client = createClient(APP, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email: stack.emailFor(player), password: 'secret1' });
  if (signed.error) throw new Error(`signInWithPassword: ${signed.error.message}`);
  const senses = sql(`select string_agg(s.id::text, ',') from public.senses s join public.headwords h on h.id = s.headword_id where h.text in (${WORDS.map((w) => `'${w}'`).join(',')})`).split(',').filter(Boolean);
  const added = await client.rpc('library_add', { p_senses: senses });
  ok(!added.error && senses.length === WORDS.length, `the ${senses.length} words join the player's library ${added.error ? added.error.message : ''}`);

  // 2. a round of the lesson, saved
  await page.reload({ waitUntil: 'networkidle' }); await settled(page);
  await openLesson(page);
  const answered = await answer(page, 100, 'h2:has-text("Session complete")');
  ok(answered > 0 && await visible(page, 'h2:has-text("Session complete")'), `the round is played to the end (${answered} answers)`);
  await page.click('button:has-text("Save results & review")');
  ok(await until(async () => /^Saved$/.test(await syncText(page)) && coreOf(id).attempted === answered), 'the round is saved: ' + await syncText(page) + ', attempted ' + coreOf(id).attempted);
  const masteryRows = Number(sql(`select count(*) from public.mastery where user_id = '${id}'`));
  ok(masteryRows > 0, `the answers are in the player's mastery rows (${masteryRows})`);
  const today = coreOf(id).dailyProgress?.answered;
  ok(today === answered, `the day's count is on the server: ${today}`);

  // 3. opened again on another device
  const tablet = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const tab = await newPage(tablet);
  await signIn(tab, player);
  const goal = (await tab.locator('.wh-daily-goal').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok(new RegExp(`\\b${answered} / \\d+ questions`).test(goal), 'another device shows what the server has: ' + goal);

  // 4. the connection is lost while playing, then comes back
  await tablet.setOffline(true);
  ok(await until(async () => /Offline/.test(await syncText(tab)), 10000), 'losing the connection shows: ' + await syncText(tab));
  await openLesson(tab);
  const offlineAnswers = await answer(tab, 3);
  ok(offlineAnswers === 3 && coreOf(id).dailyProgress?.answered === answered, `answers while offline stay on the device (${offlineAnswers}); the server still has ${coreOf(id).dailyProgress?.answered}`);
  await tablet.setOffline(false);
  ok(await until(() => coreOf(id).dailyProgress?.answered === answered + 3, 45000), `when the connection comes back, they reach the server: ${coreOf(id).dailyProgress?.answered}`);
  ok(await until(async () => /^Saved$/.test(await syncText(tab)), 20000), 'and the game says Saved: ' + await syncText(tab));

  // 5. the page is closed while offline, then the game opens again online
  // A new round, started online, then played offline; the page is closed once the game has kept the answers.
  const before = coreOf(id).dailyProgress?.answered;
  await tab.goto(APP + '/', { waitUntil: 'networkidle' }); await settled(tab); // Home (a reload would stay in the open round)
  await openLesson(tab);
  await tablet.setOffline(true);
  const more = await answer(tab, 2);
  await tab.waitForTimeout(1500); // longer than the game's save wait, so the save has been tried and kept
  ok(more === 2 && /Offline/.test(await syncText(tab)) && coreOf(id).dailyProgress?.answered === before, `offline again, ${more} answers kept on the device: ${await syncText(tab)}`);
  await tab.close();
  await tablet.setOffline(false);
  const again = await newPage(tablet);
  await again.goto(APP + '/', { waitUntil: 'networkidle' }); await settled(again);
  ok(await until(() => coreOf(id).dailyProgress?.answered === before + more, 45000), `answers kept on the device while closed reach the server when the game opens again: ${before} + ${more} -> ${coreOf(id).dailyProgress?.answered}`);

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  stack.cleanup(tag);
});

// A Live challenge between two players, from the game's screens, against the real stack (CI job "realstack": Supabase's
// Postgres, GoTrue, PostgREST and Realtime, with every migration), each player in their own browser profile, with the
// app's own channel code (src/features/live/transport.js). Made-up accounts and words only. What it proves:
// - the host makes a challenge on the form; the other player opens its link and joins; the host's lobby shows them,
//   the start reaches the other player, and each answer reaches the other's race, each through a Realtime message the
//   browser received (its WebSocket frames are read) and on screen sooner than the room's polling (20 s while live);
// - the other player's connection is lost for 10 s and comes back: the room catches up and the next answer reaches it
//   through Realtime; lost for 60 s (the socket is dropped and realtime-js reconnects): the room catches up, and the
//   next answer reaches it through Realtime too (before 2026-10-22 it came only from the 4 s polling, because the
//   room's channel had given up; docs/modules/live/README.md, Fixed);
// - both finish and see the results.
// NOT proven here: a real Supabase project (its gateway and Realtime settings). Docs: docs/integration-tests.md.
const { execFileSync } = require('node:child_process');
const helpers = require('../helpers.cjs');
const { ok, launch, run } = helpers;
const { submitLogin, settled } = require('../fakeSupabase.cjs');

const APP = process.env.REALSTACK_URL || 'http://127.0.0.1:54330';
const PGURL = process.env.REALSTACK_PGURL;
const sql = (text) => execFileSync('psql', [PGURL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SOON = 8000; // well under the room's 20 s polling while its channel is live

const tag = `lv${Date.now().toString(36).slice(-5)}`;
const WORDS = ['Drizzle', 'Downpour', 'Gust', 'Breeze', 'Thunder', 'Hail', 'Frost', 'Mist', 'Sleet', 'Fog'];
const W = (word) => ({ word, type: 'vocab', category: 'Weather', meaning: `The meaning of ${word}.`, situation: `We saw the ${word} today.`, gap: 'We saw the ______ today.' });
const text = async (page, sel) => ((await page.locator(sel).count()) ? (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim() : '');
const questionNo = async (page) => Number((/Question (\d+)\/\d+/.exec(await text(page, '.lv-qtop')) || [])[1] || 0);

// Every Realtime frame a page sends and receives, with the time (binary frames are read as text: topic and event
// names are plain ASCII in them).
function frames(page) {
  const list = [];
  let sockets = 0;
  page.on('websocket', (ws) => {
    if (!/\/realtime\/v1\//.test(ws.url())) return;
    sockets++;
    const add = (dir) => (f) => list.push({ at: Date.now(), dir, text: typeof f.payload === 'string' ? f.payload : Buffer.from(f.payload).toString('latin1') });
    ws.on('framereceived', add('in')); ws.on('framesent', add('out'));
  });
  return {
    sockets: () => sockets,
    // The last frames received on the challenge's topic, shortened (printed when a check failed).
    sample: (code) => list.filter((f) => f.dir === 'in' && f.text.includes(`live:${code}`)).slice(-4).map((f) => f.text.replace(/[^\x20-\x7e]/g, '.').slice(0, 160)),
    // A broadcast of `event` on the challenge's topic, received since `since`.
    // JSON frames carry `"event":"<name>"`; binary ones (protocol 2.0) the topic followed by the event name.
    // "presence_diff" is Realtime's own event (who has the room open), not a broadcast.
    got: (code, event, since) => list.find((f) => f.dir === 'in' && f.at >= since && f.text.includes(`live:${code}`)
      && (event === 'presence_diff' ? f.text.includes('"presence_diff"')
        : !f.text.includes('phx_') && (f.text.includes(`live:${code}${event}`) || f.text.includes(`"event":"${event}"`)))),
    // The page asked to join the challenge's channel since `since`, and the server said yes.
    joined: (code, since) => list.some((f) => f.dir === 'out' && f.at >= since && f.text.includes(`live:${code}`) && f.text.includes('phx_join'))
      && list.some((f) => f.dir === 'in' && f.at >= since && f.text.includes(`live:${code}`) && f.text.includes('phx_reply') && f.text.includes('"ok"')),
  };
}
// Waits until `check` holds on the page; returns the time it did (Date.now()), or null.
async function within(page, check, arg, ms) {
  try { await page.waitForFunction(check, arg, { timeout: ms, polling: 100 }); return Date.now(); } catch { return null; }
}
// The screen changed (at `seen`) because of `frame`: the frame came first, and the change followed within
// 1.5 s (the next poll could be up to 20 s away while the channel is live, 4 s while it is not). Returns a text
// with both times for the check's message, and whether it holds.
function causedBy(frame, t, seen) {
  const text = `message ${frame ? `at +${frame.at - t} ms` : 'not received'}, screen ${seen === null ? 'not changed' : `at +${seen - t} ms`}`;
  if (!frame || seen === null) return { yes: false, text };
  const gap = seen - frame.at;
  return { yes: gap >= -50 && gap <= 1500, text };
}
// The width of a player's bar in the race (answered / questions).
const raceWidth = ([name, width]) => [...document.querySelectorAll('.lv-race li')].some((li) => li.textContent.includes(name) && li.querySelector('.lv-race-bar i')?.style.width === width);
// Answers the question on screen (the first option) and waits for the next one, or for the end of the run.
async function answer(page) {
  const before = await questionNo(page);
  await page.locator('.wh-option').first().click();
  await page.waitForFunction((b) => { const t = document.querySelector('.lv-qtop')?.textContent || ''; return !t.includes(`Question ${b}/`) || !document.querySelector('.lv-play'); }, before, { timeout: 15000 });
  await page.waitForTimeout(200);
}
async function signIn(page, username) {
  await page.goto(APP + '/', { waitUntil: 'networkidle' }); await settled(page);
  await page.click('.auth-tabs [role="tab"]:has-text("Sign in")');
  await submitLogin(page, username, 'secret1'); await settled(page);
}

run(async () => {
  if (!PGURL) throw new Error('REALSTACK_PGURL is not set: this spec runs against the real stack (tests/realstack/run-ci.sh)');
  const stack = await import('../../tests/realstack/stack.js');
  // The host is the admin (who may create challenges and sees the whole course); the course has one made-up lesson.
  const host = await stack.signUp(`${tag}host`);
  stack.promote(host);
  const rows = WORDS.map((w, i) => ({ kind: 'words', key: w, data: W(w), position: (i + 1) * 1000 }));
  const pub = await host.client.rpc('content_save_v2', { p_draft: null, p_upserts: rows, p_removes: [], p_level_order: ['Weather'], p_note: 'Made-up content for the real-stack Live spec.', p_renames: null, p_expected_version: null, p_publish: true });
  if (pub.error) throw new Error(`content_save_v2: ${pub.error.message}`);
  const guest = await stack.signUp(`${tag}gst`);

  const browser = await launch();
  const errors = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    return { context, page, ws: frames(page) };
  };
  const H = await open(), G = await open();
  const channelLog = [];
  const start = Date.now();
  G.page.on('console', (m) => { if (/Live channel/.test(m.text())) channelLog.push(`${((Date.now() - start) / 1000).toFixed(0)}s ${m.text()}`); });
  await signIn(H.page, host.username); await signIn(G.page, guest.username);

  // 1. the host makes a challenge on the form
  await H.page.goto(APP + '/live', { waitUntil: 'networkidle' }); await settled(H.page);
  await H.page.click('button:has-text("Create a challenge")'); await H.page.waitForSelector('.lv-form');
  await H.page.click('.lv-seg[aria-label="Questions"] button:text-is("10")');
  await H.page.click('.lv-seg[aria-label="Time per question"] button:text-is("No limit")');
  await H.page.fill('.lv-field:has-text("Name") input', `Real stack ${tag}`);
  await H.page.click('button:has-text("Create and get the link")');
  await H.page.waitForSelector('.lv-lobby .lv-code', { timeout: 20000 });
  const code = (await H.page.innerText('.lv-lobby .lv-code')).trim();
  ok(/^[A-Z0-9]{6}$/.test(code) && sql(`select count(*) from public.live_challenges where code = '${code}'`) === '1', `the host's form made challenge ${code} on the server`);
  let hostJoined = false;
  for (let i = 0; i < 150 && !hostJoined; i++) { hostJoined = H.ws.joined(code, 0); if (!hostJoined) await sleep(100); }
  ok(hostJoined, 'the host\'s room joined the challenge\'s Realtime channel');

  // 2. the other player opens the link and joins; the host's lobby shows them through Realtime
  await G.page.goto(`${APP}/live/${code}`, { waitUntil: 'networkidle' }); await G.page.waitForSelector('.lv-invite', { timeout: 15000 });
  let t = Date.now();
  await G.page.click('button:has-text("Join the challenge")'); await G.page.waitForSelector('.lv-lobby', { timeout: 15000 });
  let seen = await within(H.page, (n) => [...document.querySelectorAll('.lv-people b')].some((b) => b.textContent === n), guest.username, SOON);
  // The lobby reads the challenge again on the "joined" broadcast, or on presence showing someone new: both Realtime.
  const first = [H.ws.got(code, 'joined', t), H.ws.got(code, 'presence_diff', t)].filter(Boolean).sort((a, b) => a.at - b.at)[0];
  let c = causedBy(first, t, seen);
  ok(c.yes, `the host's lobby shows the player who joined, from a Realtime message (${c.text})`);

  // 3. the start reaches the other player
  t = Date.now();
  await H.page.click('button:has-text("Start for 2 players")');
  seen = await within(G.page, () => !!document.querySelector('.lv-countdown, .lv-play'), null, SOON);
  c = causedBy(G.ws.got(code, 'start', t), t, seen);
  ok(c.yes, `the start reaches the other player, from a Realtime "start" message (${c.text})`);
  await H.page.waitForSelector('.lv-play', { timeout: 15000 }); await G.page.waitForSelector('.lv-play', { timeout: 15000 });

  // 4. an answer reaches the other's race
  t = Date.now();
  await answer(G.page);
  seen = await within(H.page, raceWidth, [guest.username, '10%'], SOON);
  c = causedBy(H.ws.got(code, 'progress', t), t, seen);
  ok(c.yes, `the host's race shows the other player's answer, from a Realtime "progress" message (${c.text})`);

  // 5. the other player's connection is lost while the host plays on, then comes back: once for 10 s (the socket
  // survives), and once for 60 s (the socket is dropped; before 2026-10-22 transport.js gave up its channel then).
  let hostAnswered = 0;
  const pct = (n) => `${n * 10}%`;
  async function outage(seconds) {
    const sockets = G.ws.sockets();
    await G.context.setOffline(true);
    await answer(H.page); hostAnswered++;
    await sleep(seconds * 1000);
    const back = Date.now();
    await G.context.setOffline(false);
    const caught = await within(G.page, raceWidth, [host.username, pct(hostAnswered)], 30000);
    ok(caught !== null, `after ${seconds} s offline, the other player's race catches up with the host's answer (${caught === null ? 'no' : `${caught - back} ms`})`);
    let again = false;
    for (let i = 0; i < 300 && !again; i++) { again = G.ws.joined(code, back); if (!again) await sleep(100); }
    const t1 = Date.now();
    await answer(H.page); hostAnswered++;
    const seen = await within(G.page, raceWidth, [host.username, pct(hostAnswered)], SOON);
    return { r: causedBy(G.ws.got(code, 'progress', t1), t1, seen), seen, t1, again, sockets: G.ws.sockets() - sockets };
  }
  const short = await outage(10);
  ok(short.r.yes, `after 10 s offline, the host's next answer reaches the other player's screen through Realtime (${short.r.text}; the same socket: ${short.sockets === 0})`);
  const long = await outage(60);
  ok(long.r.yes, `after 60 s offline, the host's next answer reaches the other player's screen through Realtime (${long.r.text}; channel joined again: ${long.again}; ${long.sockets} new socket(s))`);
  console.log('INFO the other player\'s channel, as transport.js reported it: ' + (channelLog.join(' | ') || 'nothing'));

  // 6. both finish and see the results
  while (await G.page.locator('.lv-play').count()) await answer(G.page);
  while (await H.page.locator('.lv-play').count()) await answer(H.page);
  await H.page.waitForSelector('.lv-results', { timeout: 30000 }); await G.page.waitForSelector('.lv-results', { timeout: 30000 });
  const table = await H.page.locator('.lv-table tbody tr').allInnerTexts();
  ok(table.length === 2 && table.some((r) => r.includes(guest.username)) && sql(`select state from public.live_challenges where code = '${code}'`) === 'done', 'both see the results, and the challenge is over on the server: ' + table.join(' | '));

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  if (helpers.failed) console.log(`INFO frames on live:${code}: host ${JSON.stringify(H.ws.sample(code))} / other ${JSON.stringify(G.ws.sample(code))}`);
  stack.cleanup(tag);
});

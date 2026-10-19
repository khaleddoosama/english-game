// Friends, Ranks and the profile's Live history in a real browser, with the app built for online mode and the fake
// Supabase of e2e/fakeSupabase.cjs (made-up players and numbers; no real server): the navigation badges, the four
// leaderboard tabs (what each reads, its order and values), the add-friend button, the Friends page's actions and
// messages, the profile's recent Live matches, Ranks hidden from players, and local mode's leaderboard text.
// NOT proven: the real database functions (supabase/tests/friends.sql, ranks.sql). Docs:
// docs/modules/social/friends-and-ranks.md.
const path = require('node:path');
const { ok, launch, run, OUT, APP: LOCAL } = require('../helpers.cjs');
const { createFakeSupabase, submitLogin, header } = require('../fakeSupabase.cjs');

const fake = createFakeSupabase();
const { APP, state } = fake;
const DIST = path.join(OUT, 'online-app-social');
const id = (name) => state.accounts[name].id;

// This week's Monday, as the browser (set to UTC below) works it out; and a week long gone.
const monday = (() => { const d = new Date(); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); })();
const OLD = '2025-01-06';
const stats = (score, week, weekStart, mastered, streak, wins, played) => ({ score, week_score: week, week_start: weekStart, mastered_count: mastered, study_streak: streak, live_wins: wins, live_played: played });
const players = {
  sam_01: stats(600, 90, monday, 30, 4, 1, 1),
  omar_k: stats(900, 120, monday, 40, 6, 3, 5),
  lina_p: stats(400, 300, monday, 12, 2, 0, 0),
  tariq9: stats(1500, 0, OLD, 80, 0, 5, 6),
  noor_a: stats(200, 80, monday, 5, 1, 1, 4),
  zed_old: stats(50, 999, OLD, 2, 0, 0, 2),
  rami_b: stats(0, 0, null, 0, 0, 0, 0),
  bea_x: stats(0, 0, null, 0, 0, 0, 0),
  kai_m: stats(0, 0, null, 0, 0, 0, 0),
};
Object.entries(players).forEach(([name, s], i) => {
  state.accounts[name] = { ...(state.accounts[name] || { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, password: 'secret9', role: 'player' }), stats: s };
});
state.pairs = [
  { a: 'sam_01', b: 'omar_k', by: 'omar_k', status: 'accepted' },
  { a: 'sam_01', b: 'zed_old', by: 'sam_01', status: 'accepted' },
  { a: 'sam_01', b: 'lina_p', by: 'lina_p', status: 'pending' },
  { a: 'sam_01', b: 'rami_b', by: 'rami_b', status: 'pending' },
  { a: 'sam_01', b: 'bea_x', by: 'bea_x', status: 'pending' },
  { a: 'sam_01', b: 'tariq9', by: 'sam_01', status: 'pending' },
];
state.invites = 3;
state.liveResults = [
  { user_id: id('sam_01'), room_code: 'K7M2QX', title: 'Weather words', points: 0, correct: 8, total: 10, rank: 1, players: 3, played_at: '2026-10-18T10:00:00Z', total_ms: 42500, finished: true },
  { user_id: id('sam_01'), room_code: 'B2C3D4', title: 'Hotel talk', points: 0, correct: 6, total: 10, rank: 2, players: 4, played_at: '2026-10-17T10:00:00Z', total_ms: 65000, finished: true },
  { user_id: id('sam_01'), room_code: 'C3D4E5', title: 'Solo try', points: 70, correct: 7, total: 12, rank: 1, players: 1, played_at: '2026-10-19T10:00:00Z', total_ms: null, finished: false },
  { user_id: id('omar_k'), room_code: 'Z9Y8X7', title: 'Not mine', points: 0, correct: 1, total: 5, rank: 1, players: 2, played_at: '2026-10-19T11:00:00Z', total_ms: 9000, finished: true },
];

const text = async (loc) => ((await loc.count()) ? (await loc.first().innerText()).replace(/\s+/g, ' ').trim() : '');
const badge = (page, tab) => text(page.locator(`nav.ui-bottom-nav button:has-text("${tab}") .ui-badge`));
const nav = async (page, tab) => { await page.click(`nav.ui-bottom-nav button:has-text("${tab}")`); await page.waitForTimeout(300); };
const tab = async (page, label) => { await page.click(`.ui-segmented [role="tab"]:has-text("${label}")`); await page.waitForFunction(() => !document.querySelector('.ui-skeleton-row'), null, { timeout: 10000 }); await page.waitForTimeout(300); };
// Each row: "place name value" (the name without its button and sub line).
const board = (page) => page.locator('.ui-rank-list li').evaluateAll((rows) => rows.map((li) => {
  const name = li.querySelector('.ui-rank-name').firstChild.textContent;
  const value = li.querySelector('.ui-rank-value');
  return `${li.querySelector('.ui-rank').textContent} ${name} ${value.querySelector('b').textContent}${value.querySelector('small') ? ` (${value.querySelector('small').textContent})` : ''}`;
}));
const buttonOf = (page, name) => text(page.locator(`.ui-rank-list li:has-text("${name}") .fr-add`));
const lastQuery = (table) => [...state.log].reverse().find((l) => l.what === `GET /rest/v1/${table}`)?.query || '';
const notice = (page) => text(page.locator('.fr [role="status"]'));
const waitDone = (page) => page.waitForFunction(() => ![...document.querySelectorAll('.fr button')].some((b) => /Sending…/.test(b.textContent)), null, { timeout: 10000 }).then(() => page.waitForTimeout(400));

run(async () => {
  await fake.build(DIST);
  const browser = await launch();
  const errors = [];
  const open = async (where = APP + '/') => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', timezoneId: 'UTC' });
    if (where.startsWith(APP)) await fake.serve(context, DIST);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(where, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    return page;
  };

  const page = await open();
  await submitLogin(page, 'sam_01', 'secret1'); await page.waitForTimeout(1200);
  ok(/^Hi sam_01 · /.test(await header(page)), 'signed in as a player');

  // the navigation badges
  ok(await badge(page, 'Live') === '3' && await badge(page, 'Profile') === '3', `badges: invitations on Live, friend requests on Profile: ${await badge(page, 'Live')} / ${await badge(page, 'Profile')}`);

  // Ranks: This week first
  await nav(page, 'Ranks'); await page.waitForSelector('.ui-rank-list li .ui-rank', { timeout: 10000 });
  const tabs = await page.locator('.ui-segmented [role="tab"]').evaluateAll((b) => b.map((x) => `${x.textContent}${x.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
  ok(JSON.stringify(tabs) === JSON.stringify(['Friends', 'This week*', 'All time', 'Live wins']), 'four tabs, This week chosen: ' + tabs.join(', '));
  const week = decodeURIComponent(lastQuery('profiles'));
  ok(week.includes(`week_start=eq.${monday}`) && week.includes('week_score=gt.0') && week.includes('order=week_score.desc') && week.includes('limit=50'), 'This week reads this Monday\'s rows with points, highest first, up to 50: ' + week);
  ok(JSON.stringify(await board(page)) === JSON.stringify(['1 lina_p 300', '2 omar_k 120', '3 sam_01 90', '4 noor_a 80']), 'This week: ' + (await board(page)).join(' | '));
  const samRow = page.locator('.ui-rank-list li.is-me');
  ok(await samRow.count() === 1 && /\(you\)/.test(await text(samRow)) && await text(samRow.locator('.ui-rank-sub')) === '30 mastered · 4d streak' && await text(samRow.locator('.ui-rank-value')) === '90 pts', 'the player\'s row: (you), mastered and streak, points: ' + await text(samRow));
  ok(await samRow.locator('.fr-add').count() === 0, 'no add-friend button on the player\'s own row');
  ok(await buttonOf(page, 'omar_k') === 'Friends' && await buttonOf(page, 'lina_p') === 'Accept' && await buttonOf(page, 'noor_a') === 'Add', `the button after each name: omar ${await buttonOf(page, 'omar_k')}, lina ${await buttonOf(page, 'lina_p')}, noor ${await buttonOf(page, 'noor_a')}`);
  ok(/Practice points, counted by each player's game\./.test(await text(page.locator('.ui-rank-note'))), 'the tab\'s note');

  // the add-friend button: Add sends a request by username, Accept answers one
  await page.click('.ui-rank-list li:has-text("noor_a") .fr-add'); await page.waitForTimeout(800);
  ok(state.pairs.some((p) => p.b === 'noor_a' && p.by === 'sam_01' && p.status === 'pending') && await buttonOf(page, 'noor_a') === 'Requested', 'Add: a request is sent, the button says Requested: ' + await buttonOf(page, 'noor_a'));
  await page.click('.ui-rank-list li:has-text("lina_p") .fr-add'); await page.waitForTimeout(800);
  ok(state.pairs.find((p) => p.b === 'lina_p').status === 'accepted' && await buttonOf(page, 'lina_p') === 'Friends', 'Accept: the request is accepted, the name shows Friends');
  ok(await badge(page, 'Profile') === '3', 'accepting from Ranks does not count the badges again (they catch up at the next check): ' + await badge(page, 'Profile'));

  // All time and Live wins
  await tab(page, 'All time');
  ok(/order=score\.desc/.test(lastQuery('profiles')) && JSON.stringify((await board(page)).slice(0, 6)) === JSON.stringify(['1 tariq9 1500', '2 omar_k 900', '3 sam_01 600', '4 lina_p 400', '5 noor_a 200', '6 zed_old 50']), 'All time: by score: ' + (await board(page)).slice(0, 6).join(' | '));
  ok(await buttonOf(page, 'tariq9') === 'Requested' && await buttonOf(page, 'zed_old') === 'Friends', 'a request I sent: Requested; a friend: Friends');
  await tab(page, 'Live wins');
  const live = decodeURIComponent(lastQuery('profiles'));
  ok(live.includes('live_played=gt.0') && live.includes('order=live_wins.desc,live_played.asc'), 'Live wins reads players with a match, by wins then fewer played: ' + live);
  ok(JSON.stringify(await board(page)) === JSON.stringify(['1 tariq9 5 (6 played)', '2 omar_k 3 (5 played)', '3 sam_01 1 (1 played)', '4 noor_a 1 (4 played)', '5 zed_old 0 (2 played)']), 'Live wins: ' + (await board(page)).join(' | '));
  ok(/wins/.test(await text(page.locator('.ui-rank-list li .ui-rank-value'))) && /creator made its questions/.test(await text(page.locator('.ui-rank-note'))), 'counted in wins, with the creator note');

  // Friends: the player and their friends by this week's points (an old week counts 0)
  await tab(page, 'Friends');
  const friendsQuery = decodeURIComponent(lastQuery('profiles'));
  ok(['sam_01', 'omar_k', 'zed_old', 'lina_p'].every((n) => friendsQuery.includes(id(n))), 'Friends reads the player and each friend: ' + friendsQuery);
  ok(JSON.stringify(await board(page)) === JSON.stringify(['1 lina_p 300 (400 all time)', '2 omar_k 120 (900 all time)', '3 sam_01 90 (600 all time)', '4 zed_old 0 (50 all time)']), 'Friends: ' + (await board(page)).join(' | '));
  ok(await page.locator('.ui-rank-list .fr-add').count() === 0, 'no add-friend buttons on the Friends tab');

  // a failed read, and an empty week
  state.reply['/rest/v1/profiles'] = { status: 500, body: { code: 'XX000', message: 'The database is resting.', details: null, hint: null } };
  await tab(page, 'All time');
  ok(await text(page.locator('.wh-import-error')) === 'The database is resting.' && await page.locator('.ui-rank-list li .ui-rank').count() === 0, 'a failed read shows its message: ' + await text(page.locator('.wh-import-error')));
  state.reply['/rest/v1/profiles'] = { status: 200, body: [] };
  await tab(page, 'This week');
  ok(/No points yet this week — play a round to take first place\./.test(await text(page.locator('section.ui-page'))), 'an empty week says so');
  await tab(page, 'Live wins');
  ok(/No live matches yet\./.test(await text(page.locator('section.ui-page'))), 'no Live matches says so');
  delete state.reply['/rest/v1/profiles'];

  // the profile: the Friends button's badge, and the recent Live matches (newest first, only the player's)
  await nav(page, 'Profile'); await page.waitForSelector('.ui-history li', { timeout: 10000 });
  ok(await text(page.locator('button.ui-row-btn:has-text("Friends") .ui-badge')) === await badge(page, 'Profile'), 'the Profile page\'s Friends button shows the requests: ' + await badge(page, 'Profile'));
  const history = await page.locator('.ui-history li').evaluateAll((li) => li.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  ok(/user_id=eq\./.test(lastQuery('live_results')) && /order=played_at\.desc/.test(lastQuery('live_results')) && /limit=10/.test(lastQuery('live_results')), 'the player\'s last 10 results, newest first: ' + lastQuery('live_results'));
  ok(history.length === 3 && /^#1 Solo try/.test(history[0]) && /1 players/.test(history[0]) && /7\/12 right 70 pts · unfinished$/.test(history[0]), 'one player, no time, not finished: ' + history[0]);
  ok(/^🏆 Weather words/.test(history[1]) && /3 players/.test(history[1]) && /8\/10 right 42\.5s$/.test(history[1]), 'first of three: a trophy and the time: ' + history[1]);
  ok(/^#2 Hotel talk/.test(history[2]) && /6\/10 right 1:05$/.test(history[2]), 'second place, over a minute: ' + history[2]);

  // the Friends page
  await page.click('button.ui-row-btn:has-text("Friends")'); await page.waitForSelector('.fr-list[aria-label="Friends"]', { timeout: 10000 });
  const titles = await page.locator('.fr .ui-section-title').allTextContents();
  ok(JSON.stringify(titles) === JSON.stringify(['Requests for you (2)', 'Your friends (3)', 'Waiting for an answer (2)']), 'the three lists: ' + titles.join(', '));
  const friendRows = await page.locator('.fr-list[aria-label="Friends"] li').evaluateAll((li) => li.map((x) => x.querySelector('.fr-name').innerText.replace(/\s+/g, ' ').trim()));
  ok(JSON.stringify(friendRows) === JSON.stringify(['lina_p 400 pts · 2d streak · 0 live wins', 'omar_k 900 pts · 6d streak · 3 live wins', 'zed_old 50 pts · 0d streak · 0 live wins']), 'friends by name, with their numbers: ' + friendRows.join(' | '));
  const input = page.locator('form[aria-label="Add a friend"] input'), send = page.locator('form[aria-label="Add a friend"] button');
  ok(await send.isDisabled(), 'Send request is disabled while the field is empty');
  await input.fill('ghost'); await send.click(); await waitDone(page);
  ok(await notice(page) === 'No player is called "ghost". Check the spelling.', 'an unknown name: the server\'s message: ' + await notice(page));
  await input.fill('ghos');
  ok(await notice(page) === '', 'typing clears the message');
  await input.fill('noor_a'); await send.click(); await waitDone(page);
  ok(await notice(page) === 'You already asked noor_a. Waiting for them to answer.', 'asking again: ' + await notice(page));
  await input.fill(' Rami_B '); await send.click(); await waitDone(page);
  ok(await notice(page) === 'You and rami_b are friends now.' && await input.inputValue() === '', 'asking someone who asked me: friends at once, the field is cleared: ' + await notice(page));
  ok(await badge(page, 'Profile') === '1', 'after a change on this page the badges are counted again: ' + await badge(page, 'Profile'));
  await input.fill('kai_m'); await send.click(); await waitDone(page);
  ok(await notice(page) === "Request sent to kai_m. They'll see it next time they open the game." && /kai_m/.test(await text(page.locator('.fr-list[aria-label="Sent requests"]'))), 'a new request: ' + await notice(page));
  await page.click('.fr-list[aria-label="Sent requests"] li:has-text("kai_m") button:has-text("Cancel")'); await waitDone(page);
  ok(await notice(page) === 'Request taken back.' && state.pairs.find((p) => p.b === 'kai_m').status === 'cancelled', 'Cancel: ' + await notice(page));
  await page.click('.fr-list[aria-label="Friend requests"] li:has-text("bea_x") button:has-text("Decline")'); await waitDone(page);
  ok(await notice(page) === '' && state.pairs.find((p) => p.b === 'bea_x').status === 'declined' && !(await page.locator('.fr-list[aria-label="Friend requests"]').count()), 'Decline: no message, the request is gone');
  await page.click('button[aria-label="Remove omar_k"]');
  ok(await page.locator('.fr-list[aria-label="Friends"] li:has-text("omar_k") button:has-text("Sure?")').count() === 1 && state.pairs.find((p) => p.b === 'omar_k').status === 'accepted', 'Remove asks "Sure?" first');
  await page.click('.fr-list[aria-label="Friends"] li:has-text("omar_k") button:has-text("Sure?")'); await waitDone(page);
  ok(await notice(page) === 'omar_k is no longer your friend.' && state.pairs.find((p) => p.b === 'omar_k').status === 'removed', 'the second tap removes: ' + await notice(page));
  state.down['/rest/v1/rpc/friend_request'] = true;
  await input.fill('kai_m'); await send.click(); await waitDone(page);
  ok(await notice(page) === "You're offline. Friends need a connection.", 'no connection: ' + await notice(page));
  delete state.down['/rest/v1/rpc/friend_request'];
  await page.click('.fr-list[aria-label="Friends"] li:has-text("lina_p") button:has-text("Challenge")'); await page.waitForTimeout(500);
  ok(new URL(page.url()).pathname === '/live' && new URL(page.url()).searchParams.get('invite') === id('lina_p'), 'Challenge opens Live with the friend to invite: ' + page.url().replace(APP, ''));
  await page.screenshot({ path: `${OUT}/shot-social.png`, fullPage: true });

  // a history row opens its challenge
  await page.goto(APP + '/profile', { waitUntil: 'networkidle' }); await page.waitForSelector('.ui-history li', { timeout: 20000 });
  await page.click('.ui-history li:has-text("Hotel talk")'); await page.waitForTimeout(500);
  ok(new URL(page.url()).pathname === '/live/B2C3D4', 'a recent match opens its challenge: ' + new URL(page.url()).pathname);

  // ranks off: players lose the tab and the address; the admin keeps the page with a note
  state.settings = { leaderboard: false };
  const player = await open();
  await submitLogin(player, 'sam_01', 'secret1'); await player.waitForTimeout(800);
  ok(!(await player.locator('nav.ui-bottom-nav button:has-text("Ranks")').count()), 'ranks off: a player has no Ranks tab');
  await player.goto(APP + '/leaderboard', { waitUntil: 'networkidle' }); await player.waitForSelector('.wh-sub', { timeout: 20000 }); await player.waitForTimeout(800);
  ok(new URL(player.url()).pathname === '/', 'ranks off: /leaderboard goes home for a player: ' + new URL(player.url()).pathname);
  const admin = await open();
  await submitLogin(admin, 'ada_admin', 'secret2'); await admin.waitForTimeout(800);
  await nav(admin, 'Ranks'); await admin.waitForTimeout(800);
  ok(await text(admin.locator('.ui-note')) === 'Ranks are hidden from players (Admin → Settings → Ranks). Only you can see this page.', 'ranks off: the admin sees the page with a note');
  state.settings = { signupsOpen: true };

  // local mode: no reads, the page says why
  const local = await open(LOCAL + '/leaderboard');
  ok(/The leaderboard needs the online version\./.test(await text(local.locator('section.ui-page'))) && await local.locator('.ui-rank-list li .ui-rank').count() === 0, 'local mode: the leaderboard needs the online version');

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

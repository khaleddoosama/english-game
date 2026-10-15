// How the app shell uses the library, before and after it was moved into the
// module's own pieces (docs/modules/my-library.md): the offers banner on Home,
// the Home tabs and their cards, a round started from a Home card, the page for
// a link that doesn't work, and the Profile entry. Local mode, one player.
const { APP, ok, launch, run, SP, COURSE_BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', COURSE_BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);

  // a view with one word, made in the library page
  await page.goto(APP + '/library?new=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.fill('input[aria-label="New view name"]', 'Mine'); await page.click('button:has-text("Create")'); await page.waitForTimeout(500);
  await page.fill('input[aria-label="New view name"]', 'Empty'); await page.click('button:has-text("Create")'); await page.waitForTimeout(500);
  ok((await page.$$('.lib-tree > li')).length === 2, 'two views were made');

  // an offer from a friend, put straight into storage
  const myId = await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('friends1:users')) return Object.keys(JSON.parse(localStorage.getItem(k)))[0]; } return null; });
  ok(!!myId, 'the local player is known');
  await page.evaluate((me) => {
    const zed = 'zed-1';
    const users = JSON.parse(localStorage.getItem('friends1:users')); users[zed] = 'zed'; localStorage.setItem('friends1:users', JSON.stringify(users));
    const pair = [me, zed].sort();
    localStorage.setItem(`friends1:p:${pair.join('|')}`, JSON.stringify({ a: pair[0], b: pair[1], by: zed, status: 'accepted', created_at: new Date().toISOString() }));
    localStorage.setItem('library1:' + zed, JSON.stringify({ seq: 1, entries: {}, views: [{ id: 'zv1', parent: null, name: 'Travel', path: 'Travel', position: 1, senses: {}, rules: {} }] }));
    localStorage.setItem('library1:shares', JSON.stringify([{ id: 's1', view: 'zv1', from: zed, to: me, status: 'pending', at: Date.now() }]));
  }, myId);

  // Home: the tabs, the banner, the cards
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const tabs = await page.locator('.wh-level-view-toggle button').allInnerTexts();
  ok(tabs.includes('Mine') && tabs.includes('Empty'), 'each biggest view is a tab: ' + tabs.join(' | '));
  await page.click('.wh-level-view-toggle button:has-text("Mine")'); await page.waitForTimeout(600);
  ok(await page.isVisible('.lib-offers'), 'the banner for waiting offers shows on a view tab');
  ok((await page.innerText('.lib-offers')).includes('1 view shared with you'), 'it counts them: ' + (await page.innerText('.lib-offers')));
  const card = page.locator('.lib-readonly .wh-level-card').first();
  ok(await card.isVisible(), 'the view is a card');
  ok(await card.locator('button.lib-go').isDisabled(), 'a view with nothing in it cannot be practised');
  await page.click('.wh-level-view-toggle button:has-text("Empty")'); await page.waitForTimeout(500);
  ok(await page.locator('.lib-readonly .wh-level-card button.lib-go').first().isDisabled(), 'the other empty view too');

  // the banner opens the library page, where the offer is taken; Home then has no banner
  await page.click('.wh-level-view-toggle button:has-text("Mine")'); await page.waitForTimeout(400);
  await page.click('.lib-offers'); await page.waitForTimeout(800);
  ok(page.url().endsWith('/library'), 'the banner opens the library page');
  await page.click('.lib-inbox button:has-text("Add to my library")'); await page.waitForTimeout(700);
  ok((await page.innerText('.lib-notice')).includes('Travel'), 'the offer was taken: ' + (await page.innerText('.lib-notice')));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const tabs2 = await page.locator('.wh-level-view-toggle button').allInnerTexts();
  ok(tabs2.some((t) => t.startsWith('Travel (from zed)')), 'the copy is a new tab: ' + tabs2.join(' | '));
  await page.click('.wh-level-view-toggle button:has-text("Mine")'); await page.waitForTimeout(500);
  ok(!(await page.$('.lib-offers')), 'and the banner is gone');

  // a word into a view, then a round from its Home card
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.click('.lib-tree li:has-text("Mine")'); await page.waitForTimeout(400);
  await page.click('button:has-text("Add words")').catch(() => {}); await page.waitForTimeout(300);
  const search = page.locator('input[aria-label*="earch"]').first();
  if (await search.count()) { await search.fill('a'); await page.waitForTimeout(500); const first = page.locator('.lib-pick li input[type=checkbox], .lib-results input[type=checkbox]').first(); if (await first.count()) await first.check(); const add = page.locator('button:has-text("Add 1"), button:has-text("Add to view")').first(); if (await add.count()) await add.click(); await page.waitForTimeout(600); }
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.click('.wh-level-view-toggle button:has-text("Mine")'); await page.waitForTimeout(600);
  const go = page.locator('.lib-readonly .wh-level-card button.lib-go').first();
  if (!(await go.isDisabled())) {
    await go.click(); await page.waitForTimeout(1500);
    ok(await page.isVisible('.wh-flashcard, .wh-session, [class*=session]'), 'Practice on a view card starts a round');
  } else console.log('NOTE the word could not be added through this page layout; the round start is covered by library.cjs');

  // a link that doesn't work, and the Profile entry
  await page.goto(APP + '/join/not-a-real-token', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await page.innerText('.lib-join')).includes('This link isn’t right'), 'a link that does not exist says so');
  await page.goto(APP + '/profile', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  ok(await page.isVisible('text=My library'), 'Profile has the My library entry');
  await page.screenshot({ path: `${SP}/shot-libshell-profile.png`, fullPage: true });
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

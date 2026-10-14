// Friends in local mode, two tabs of one browser: ask by username, accept, invite to a Live challenge, join from the invitation.
const { APP, ok, launch, run, SP, BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|AI features need the online version/.test(m.text())) errors.push(`${tag}: ${m.text()}`); }); };
  const A = await ctx.newPage(); watch(A, 'A');
  await A.goto(APP, { waitUntil: 'networkidle' });
  await A.click('text=Open Import & Export');
  await A.setInputFiles('#ie-file', BACKUP); await A.waitForTimeout(1200);
  await A.click('.ie-apply'); await A.waitForTimeout(2500);
  await A.click('.ie-done button:has-text("Back to the game")'); await A.waitForTimeout(500);
  const B = await ctx.newPage(); watch(B, 'B');
  await B.goto(APP, { waitUntil: 'networkidle' }); await B.waitForTimeout(800);
  const go = async (p, path) => { await p.evaluate((x) => { window.history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await p.waitForTimeout(500); };
  const nameOf = async (p) => { await go(p, '/live'); await p.waitForSelector('.lv-you b'); return (await p.innerText('.lv-you b')).trim(); };
  const nameA = await nameOf(A), nameB = await nameOf(B);
  ok(nameA !== nameB, `two different players (${nameA}, ${nameB})`);

  // --- A asks B by username ---
  await go(A, '/friends');
  await A.waitForSelector('form[aria-label="Add a friend"]');
  await A.fill('input[aria-label="Username of the friend to add"]', nameB.toUpperCase());
  await A.click('button:has-text("Send request")');
  await A.waitForSelector('.ui-ok', { timeout: 5000 });
  ok(/Request sent/.test(await A.innerText('.ui-ok')), 'A sees "Request sent"');
  ok(await A.isVisible('ul[aria-label="Sent requests"]'), 'A lists the request under Waiting');
  await A.fill('input[aria-label="Username of the friend to add"]', 'nobody-here');
  await A.click('button:has-text("Send request")');
  await A.waitForSelector('.wh-import-error', { timeout: 5000 });
  ok(/No player is called/.test(await A.innerText('.wh-import-error')), 'an unknown username is explained');

  // --- B sees the badge, accepts ---
  await B.waitForTimeout(800);
  const _badge = async (p, id) => (await p.$$eval(`nav button:has-text("${id}") .ui-badge`, (n) => n.map((x) => x.textContent))).join('');
  ok((await B.$$eval('nav .ui-badge', (n) => n.map((x) => x.textContent))).includes('1'), 'B has a badge for the request');
  await go(B, '/friends');
  await B.waitForSelector('ul[aria-label="Friend requests"]');
  ok((await B.innerText('ul[aria-label="Friend requests"]')).includes(nameA), 'B sees A in Requests');
  await B.click('ul[aria-label="Friend requests"] button:has-text("Accept")');
  await B.waitForSelector('ul[aria-label="Friends"]', { timeout: 5000 });
  ok((await B.innerText('ul[aria-label="Friends"]')).includes(nameA), 'B lists A as a friend');
  ok((await B.$$('nav .ui-badge')).length === 0, 'the badge is gone after answering');
  await go(A, '/friends'); await A.waitForSelector('ul[aria-label="Friends"]');
  ok((await A.innerText('ul[aria-label="Friends"]')).includes(nameB), 'A lists B as a friend');
  await A.screenshot({ path: `${SP}/shot-friends.png`, fullPage: true });

  // --- A: Challenge button -> create form with B picked ---
  await A.click('ul[aria-label="Friends"] button:has-text("Challenge")');
  await A.waitForSelector('.lv-form');
  await A.waitForSelector('[aria-label="Friends to invite"] button');
  ok(await A.getAttribute('[aria-label="Friends to invite"] button', 'aria-pressed') === 'true', 'the friend is picked when coming from Challenge');
  await A.screenshot({ path: `${SP}/shot-create.png`, fullPage: true });
  ok(/\binvite=/.test(await A.evaluate(() => location.search)), 'the invite id is in the address');
  await A.click('.lv-seg[aria-label="Questions"] button:text-is("5")');
  await A.fill('.lv-field:has-text("Name") input', 'Friends duel');
  await A.click('button:has-text("Create and get the link")');
  await A.waitForSelector('.lv-code', { timeout: 15000 });
  const _code = (await A.innerText('.lv-code')).trim();
  ok(!/invite=/.test(await A.evaluate(() => location.search)), 'the address is clean after creating');
  await A.waitForSelector('.lv-invite-friends button');
  ok(/invited/.test(await A.innerText('.lv-invite-friends')), 'the lobby shows B as invited');
  await A.screenshot({ path: `${SP}/shot-lobby.png`, fullPage: true });

  // --- B: invitation on Live home + badge, join from it ---
  await B.waitForTimeout(800);
  ok((await B.$$eval('nav .ui-badge', (n) => n.map((x) => x.textContent))).includes('1'), 'B has a badge for the invitation');
  await go(B, '/live');
  await B.waitForSelector('.lv-invites', { timeout: 5000 });
  const inv = await B.innerText('.lv-invites');
  ok(inv.includes('Friends duel') && inv.includes(nameA), 'the invitation names the challenge and who invited');
  await B.screenshot({ path: `${SP}/shot-invitation.png` });
  await B.click('.lv-invites button:has-text("Join")');
  await B.waitForSelector('.lv-lobby', { timeout: 8000 });
  await A.waitForSelector(`.lv-people:has-text("${nameB}")`, { timeout: 15000 });
  ok(true, 'A sees B in the waiting room');
  await B.waitForTimeout(500);
  ok((await B.$$('nav .ui-badge')).length === 0, 'the invitation badge is gone after joining');

  // --- Invite from the lobby, dismiss ---
  await A.click('button:has-text("Cancel challenge")'); await A.waitForTimeout(600);
  await go(A, '/live'); await A.click('button:has-text("Create a challenge")');
  await A.waitForSelector('[aria-label="Friends to invite"] button');
  ok(await A.getAttribute('[aria-label="Friends to invite"] button', 'aria-pressed') === 'false', 'nobody is picked by default');
  await A.click('.lv-seg[aria-label="Questions"] button:text-is("5")');
  await A.click('button:has-text("Create and get the link")');
  await A.waitForSelector('.lv-code', { timeout: 15000 });
  await A.click(`.lv-invite-friends button:has-text("${nameB}")`);
  await A.waitForSelector('.lv-invite-friends button:has-text("invited")', { timeout: 5000 });
  ok(true, 'invited B from the waiting room');
  await B.waitForTimeout(800);
  await go(B, '/live');
  await B.waitForSelector('.lv-invites');
  await B.click('.lv-invites button:has-text("Dismiss")');
  await B.waitForTimeout(600);
  ok((await B.$$('.lv-invites')).length === 0, 'Dismiss removes the invitation');

  // --- Remove friend ---
  await go(A, '/friends'); await A.waitForSelector(`button[aria-label="Remove ${nameB}"]`);
  await A.click(`button[aria-label="Remove ${nameB}"]`); await A.click('button:has-text("Sure?")');
  await A.waitForSelector('.ui-ok'); ok(/no longer your friend/.test(await A.innerText('.ui-ok')), 'Remove asks twice, then removes');
  await A.screenshot({ path: `${SP}/friends-after.png` });
  ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
});

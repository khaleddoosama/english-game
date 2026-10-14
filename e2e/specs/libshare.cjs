// Sharing a view between two local players in two browser contexts that share one origin storage
// (same context, two profiles via the app's local tab player is not available), so: seed storage directly
// as a second player, then use the UI as the first.
const { APP, ok, launch, run, SP, BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);
  await page.goto(APP + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  // who am I in local mode?
  const _me = await page.evaluate(() => { const k = Object.keys(localStorage).filter((x) => x.startsWith('library1:')); return k; });
  // make a friend "zed" and an offer from zed: build zed's library and the share record straight into storage
  const myId = await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('friends1:users')) return Object.keys(JSON.parse(localStorage.getItem(k)))[0]; } return null; });
  console.log('my id', myId);
  ok(!!myId, 'the local player is known to the friends storage');
  await page.evaluate((myId) => {
    const zed = 'zed-1';
    const users = JSON.parse(localStorage.getItem('friends1:users')); users[zed] = 'zed'; localStorage.setItem('friends1:users', JSON.stringify(users));
    localStorage.setItem(`friends1:p:${[myId, zed].sort().join('|')}`, JSON.stringify({ a: [myId, zed].sort()[0], b: [myId, zed].sort()[1], by: zed, status: 'accepted', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    const _words = JSON.parse(localStorage.getItem('wh-words-cache') || 'null');
    localStorage.setItem('library1:' + zed, JSON.stringify({ seq: 2, entries: { Campaign: {}, Allowance: {} }, views: [
      { id: 'zv1', parent: null, name: 'Work', path: 'Work', position: 1, senses: { Campaign: { at: 1 } }, rules: {} },
      { id: 'zv2', parent: 'zv1', name: 'Money', path: 'Work::Money', position: 1, senses: { Allowance: { at: 1 } }, rules: {} }] }));
    localStorage.setItem('library1:shares', JSON.stringify([{ id: 's1', view: 'zv1', from: zed, to: myId, status: 'pending', at: Date.now() }]));
  }, myId);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  ok(await page.isVisible('.lib-inbox'), 'the offer shows in "Shared with you"');
  ok((await page.innerText('.lib-inbox')).includes('from zed'), 'it says who sent it');
  await page.screenshot({ path: `${SP}/shot-share-inbox.png`, fullPage: true });
  await page.click('.lib-inbox button:has-text("Add to my library")'); await page.waitForTimeout(600);
  ok(!(await page.$('.lib-inbox')), 'the inbox empties');
  ok((await page.$$('.lib-tree > li')).length === 2, 'the copy has two views');
  ok((await page.innerText('.lib-tree')).includes('Work (from zed)'), 'named after the sender');
  ok((await page.innerText('.lib-notice')).includes('2 words'), 'the notice counts the words: ' + (await page.innerText('.lib-notice')));
  // share one of mine back: the friend list shows zed
  // the copy is already selected after accepting
  await page.click('.lib-share summary'); await page.waitForTimeout(500);
  ok((await page.innerText('.lib-share')).includes('zed'), 'the friend appears in the share list');
  await page.check('.lib-friends input'); await page.click('.lib-share button:has-text("Send")'); await page.waitForTimeout(500);
  ok((await page.innerText('.lib-notice')).includes('Sent to 1 friend'), 'sent: ' + (await page.innerText('.lib-notice')));
  const shares = await page.evaluate(() => JSON.parse(localStorage.getItem('library1:shares')));
  ok(shares.some((s) => s.to === 'zed-1' && s.status === 'pending'), 'the offer is stored for zed');
  await page.screenshot({ path: `${SP}/shot-share-sent.png`, fullPage: true });
  // practise the copy
  await page.click('.lib-tree li:first-child .lib-go'); await page.waitForTimeout(1500);
  ok(await page.isVisible('.wh-flashcard, .wh-session, [class*=session]'), 'a round starts from the shared copy');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

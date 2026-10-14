// A sweep for runtime errors: opens every page of the app (player and admin) at phone and desktop
// width, with the course loaded, and plays a few questions of a round. Any uncaught error, React
// error or "something went wrong" screen fails it. It checks the pages open, not what is on them.
const { APP, ok, launch, run, BACKUP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CERT|net::/.test(m.text())) errors.push(`${tag} console: ${m.text().slice(0, 200)}`); });
  };
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); watch(page, 'phone');
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', BACKUP); await page.waitForTimeout(1500);
  await page.click('.ie-apply'); await page.waitForTimeout(2500);

  const player = ['/', '/stories', '/live', '/leaderboard', '/profile', '/friends', '/library', '/library?new=1', '/catalog', '/stats', '/badges', '/data', '/settings', '/join/not-a-real-link', '/no/such/page'];
  const admin = ['', '/players', '/live', '/ai', '/audit', '/quality', '/settings', '/words', '/categories', '/reports', '/library', '/grammar'];
  const sizes = [{ width: 430, height: 900 }, { width: 1280, height: 900 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const p of player) {
      await page.goto(APP + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
      const body = (await page.innerText('body')).trim();
      ok(body.length > 20 && !/something went wrong|application error/i.test(body), `${size.width}px ${p} opens`);
    }
    for (const a of admin) {
      await page.goto(`${APP}/admin${a}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
      const body = (await page.innerText('body')).trim();
      ok(body.length > 20 && !/something went wrong|application error/i.test(body), `${size.width}px /admin${a} opens`);
    }
  }

  // play a few questions of a lesson round, picking the first option or typing something each time
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  await page.click('.wh-level-btn:has-text("Practice") >> nth=0'); await page.waitForTimeout(1200);
  let answered = 0;
  for (let i = 0; i < 12; i++) {
    const opts = await page.$$('.wh-options button, .wh-option, button.wh-opt');
    if (opts.length) { await opts[0].click().catch(() => {}); answered++; }
    else {
      const input = await page.$('input[type="text"], textarea');
      if (input) { await input.fill('test').catch(() => {}); await page.keyboard.press('Enter'); answered++; }
    }
    await page.waitForTimeout(500);
    const next = await page.$('button:has-text("Next"), button:has-text("Continue"), button:has-text("Skip")');
    if (next) await next.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  ok(answered > 0, `a round starts and takes answers (${answered} answered)`);
  ok(errors.length === 0, 'no runtime errors anywhere: ' + [...new Set(errors)].slice(0, 6).join(' | '));
});

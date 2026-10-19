// Access in a real browser, with the app built for online mode and the fake Supabase of e2e/fakeSupabase.cjs (made-up
// accounts; no real server): maintenance mode (players wait with the admin's message, the admin plays on), changing
// the password on the Profile page, and signing out after the saves (it waits for a running save, but not more than
// about 5 seconds). Docs: docs/modules/accounts/sign-in.md.
const path = require('node:path');
const { ok, launch, run, OUT } = require('../helpers.cjs');
const { createFakeSupabase, submitLogin, header } = require('../fakeSupabase.cjs');

const fake = createFakeSupabase();
const { APP, state } = fake;
const DIST = path.join(OUT, 'online-app-access');
const SAVE = '/rest/v1/rpc/save_progress_v2';
const body = async (page) => (await page.innerText('body')).replace(/\s+/g, ' ');
const maintenanceText = async (page) => { const el = page.locator('.splash .load-error'); return (await el.count()) ? (await el.innerText()).trim() : ''; };

run(async () => {
  await fake.build(DIST);
  const browser = await launch();
  const errors = [];
  const open = async (path = '/') => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    await fake.serve(context, DIST);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(APP + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    return page;
  };

  // maintenance: a player waits, with the admin's message
  state.settings = { maintenance: true, maintenanceMessage: 'Back at noon with new words.' };
  const player = await open();
  const beforeLogin = state.log.length;
  await submitLogin(player, 'sam_01', 'secret1'); await player.waitForTimeout(1500);
  const loads = state.log.slice(beforeLogin).filter((l) => l.what === 'GET /rest/v1/progress').length, saves = state.log.slice(beforeLogin).filter((l) => l.what === 'POST /rest/v1/rpc/save_progress_v2').length;
  ok(loads >= 1, `maintenance is shown after the player's game has loaded (progress read ${loads}x; saves meanwhile: ${saves})`);
  ok(await maintenanceText(player) === 'Back at noon with new words.' && !(await header(player)), 'maintenance: a player sees the message, not the game: ' + await maintenanceText(player));
  ok(await player.locator('.splash button:has-text("Try again")').count() === 1, 'with a Try again button');
  state.settings = { maintenance: true, maintenanceMessage: '' };
  await player.click('.splash button:has-text("Try again")'); await player.waitForSelector('.splash .load-error, .wh-sub', { timeout: 20000 });
  ok(await maintenanceText(player) === "We're improving the game. Please come back a little later.", 'no message set: the default one: ' + await maintenanceText(player));
  state.settings = { maintenance: false };
  await player.click('.splash button:has-text("Try again")'); await player.waitForSelector('.wh-sub', { timeout: 20000 });
  ok(/^Hi sam_01 · /.test(await header(player)), 'maintenance over: Try again opens the game');
  // ...and the admin plays on during maintenance
  state.settings = { maintenance: true, maintenanceMessage: 'Back at noon with new words.' };
  const admin = await open();
  await submitLogin(admin, 'ada_admin', 'secret2');
  ok(/^Hi ada_admin · /.test(await header(admin)) && !(await maintenanceText(admin)), 'maintenance: the admin plays on');
  state.settings = { maintenance: false };

  // changing the password (Profile)
  await player.goto(APP + '/profile', { waitUntil: 'networkidle' }); await player.waitForSelector('.ui-inline-form', { timeout: 20000 });
  const pw = player.locator('.ui-inline-form input[type="password"]'), save = player.locator('.ui-inline-form button');
  await pw.fill('12345');
  ok(await save.isDisabled(), 'under 6 characters: Save is disabled');
  state.reply['/auth/v1/user'] = { status: 422, body: { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' } };
  await pw.fill('secret1'); await save.click(); await player.waitForTimeout(800);
  ok(/New password should be different from the old password\./.test(await body(player)), 'a refusal shows the server\'s message');
  await pw.fill('secret12');
  ok(!/New password should be different/.test(await body(player)), 'typing clears the message');
  delete state.reply['/auth/v1/user'];
  await save.click(); await player.waitForTimeout(800);
  ok(/Password changed\./.test(await body(player)) && await pw.inputValue() === '' && state.accounts.sam_01.password === 'secret12', 'a new password is saved, the field cleared, and it says so');

  // signing out: a waiting save is sent at once, and the sign-out waits for it...
  await player.click('button[title="Log out"]'); await player.waitForSelector('form.auth-card', { timeout: 20000 });
  await submitLogin(player, 'sam_01', 'secret12');
  ok(/^Hi sam_01 · /.test(await header(player)), 'the new password signs in');
  const logOutAfterAChange = async () => {
    await player.goto(APP + '/settings', { waitUntil: 'networkidle' }); await player.waitForSelector('[role="switch"][aria-label="Sound effects"]', { timeout: 20000 });
    await player.waitForTimeout(1500);
    const mark = state.log.length;
    const soundAfter = (await player.getAttribute('[role="switch"][aria-label="Sound effects"]', 'aria-checked')) !== 'true';
    // change a setting (its save waits 600 ms), and press Log out 100 ms later
    const clicked = Date.now();
    const busy = await player.evaluate(async () => {
      document.querySelector('[role="switch"][aria-label="Sound effects"]').click();
      await new Promise((r) => setTimeout(r, 100));
      document.querySelector('button[title="Log out"]').click();
      await new Promise((r) => setTimeout(r, 50));
      return document.querySelector('button[title="Log out"]')?.innerText || '';
    });
    await player.waitForSelector('form.auth-card', { timeout: 20000 });
    const since = state.log.slice(mark);
    const out = since.find((l) => l.what === 'POST /auth/v1/logout'), outAt = since.indexOf(out);
    // the save that carries the change, and whether every save sent so far was answered before the sign-out
    const changed = since.find((l) => l.what === `POST ${SAVE}` && JSON.stringify(l.body).includes(`"sound":${soundAfter}`));
    const before = state.log.slice(0, mark + outAt);
    const sent = before.filter((l) => l.what === `POST ${SAVE}`).length, answered = before.filter((l) => l.what === `answered ${SAVE}`).length;
    return { busy, carried: !!changed && since.indexOf(changed) < outAt, outAfter: out ? out.at - clicked : null, allAnsweredFirst: sent > 0 && answered === sent };
  };
  state.holdMs[SAVE] = 2500;
  const first = await logOutAfterAChange();
  ok(/Logging out…/.test(first.busy), 'the button says "Logging out…" meanwhile: ' + first.busy.trim());
  ok(first.carried, 'the change made just before is saved, not lost: its save is sent before the sign-out');
  ok(first.allAnsweredFirst && first.outAfter >= 2400, `the sign-out is sent only after every running save is answered (${first.outAfter} ms)`);
  // ...but not more than about 5 seconds
  state.holdMs[SAVE] = 20000;
  await submitLogin(player, 'sam_01', 'secret12');
  const second = await logOutAfterAChange();
  ok(!second.allAnsweredFirst && second.outAfter >= 4500 && second.outAfter < 9000, `a save that never answers: the sign-out goes after about 5 s (${second.outAfter} ms)`);
  state.holdMs[SAVE] = 0;

  await player.screenshot({ path: `${OUT}/shot-access.png`, fullPage: true });
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

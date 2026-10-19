// Signing in, signing up and signing out in a real browser, with the app built for online mode (Supabase settings
// pointing at a made-up address) and a fake Supabase answered by this spec: the auth endpoints, the profile row, app
// settings, register_player, and empty answers for the game's own data. Made-up accounts; no real server is reached.
// What it proves: the login page, its messages, the session kept across a reload, the offline start with the cached
// profile, the Admin tab for the admin only, and signing out. NOT proven: the real Supabase Auth or database (their
// rules: supabase/tests/signup_limits.sql). Docs: docs/modules/accounts/sign-in.md.
const path = require('node:path');
const { ok, launch, run, OUT } = require('../helpers.cjs');
const { createFakeSupabase, loginMessage: message, submitLogin: submit, onLogin, header, settled } = require('../fakeSupabase.cjs');

const fake = createFakeSupabase();
const { APP } = fake;
const server = fake.state;
const DIST = path.join(OUT, 'online-app');
const serve = (context) => fake.serve(context, DIST);
const tabs = async (page) => page.locator('.auth-tabs [role="tab"]').allInnerTexts();

run(async () => {
  // The app as an online deployment builds it, pointing at the fake server.
  await fake.build(DIST);

  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await serve(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // signed out: the login page, sign-ups open
  await page.goto(APP + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok(await onLogin(page) && JSON.stringify(await tabs(page)) === JSON.stringify(['Sign in', 'Create account']), 'signed out: the login page with both tabs');

  // sign in: the username rule, a wrong password, another refusal
  const before = server.calls.length;
  await submit(page, 'ab', 'secret1');
  ok(await message(page) === 'Usernames are 3–20 letters, numbers or _.' && server.calls.length === before, 'a bad username is refused before anything is sent: ' + await message(page));
  await submit(page, ' Sam_01 ', 'wrong-pw');
  ok(await message(page) === 'Wrong username or password.', 'a wrong password: ' + await message(page));
  await submit(page, 'sam_01', 'too-many');
  ok(await message(page) === 'Request rate limit reached', 'any other refusal shows the server\'s message: ' + await message(page));
  await page.click('.auth-tabs [role="tab"]:has-text("Create account")');
  ok(await message(page) === '', 'changing the tab clears the message');

  // create account: a taken name, then a new one
  await submit(page, 'sam_01', 'secret9');
  ok(await message(page) === 'That username is taken', 'a taken username: ' + await message(page));
  await submit(page, ' New_Player ', 'secret3');
  ok(!(await onLogin(page)) && /^Hi new_player · /.test(await header(page)), 'a new account is created and signed in: ' + await header(page));
  ok(server.accounts.new_player?.password === 'secret3', 'the account was created with the cleaned username');
  ok(!(await page.locator('.ui-tab:has-text("Admin"), nav :text-is("Admin")').count()), 'a player has no Admin tab');

  // signing out
  await page.click('button[title="Log out"]'); await page.waitForSelector('form.auth-card', { timeout: 20000 });
  ok(await onLogin(page) && server.calls.includes('POST /auth/v1/logout'), 'Log out returns to the login page');

  // the admin, across a reload
  await page.click('.auth-tabs [role="tab"]:has-text("Sign in")');
  await submit(page, 'ada_admin', 'secret2');
  ok(/^Hi ada_admin · /.test(await header(page)) && (await page.locator('nav :text-is("Admin")').count()) > 0, 'the admin is signed in and has the Admin tab: ' + await header(page));
  ok(JSON.parse(await page.evaluate(() => localStorage.getItem('wh-profile:00000000-0000-4000-8000-000000000002')) || 'null')?.role === 'admin', 'the profile is cached in this browser');
  await page.reload({ waitUntil: 'networkidle' }); await settled(page);
  ok(/^Hi ada_admin · /.test(await header(page)), 'after a reload the session is kept');

  // offline start: the profile cannot be read, the cached one is used
  server.profileDown = true;
  await page.reload({ waitUntil: 'networkidle' }); await settled(page);
  ok(/^Hi ada_admin · /.test(await header(page)), 'offline start: the cached profile is used: ' + await header(page));
  // ...and with no cached profile, the login page says why
  await page.evaluate(() => localStorage.removeItem('wh-profile:00000000-0000-4000-8000-000000000002'));
  await page.reload({ waitUntil: 'networkidle' }); await settled(page);
  ok(await onLogin(page) && await message(page) === "Couldn't load your account. Check your connection and try again.", 'no cached profile: ' + await message(page));
  server.profileDown = false;

  // sign-ups closed, and a Live link
  server.settings = { signupsOpen: false };
  const fresh = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await serve(fresh);
  const guest = await fresh.newPage();
  guest.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await guest.goto(APP + '/live/K7M2QX', { waitUntil: 'networkidle' }); await guest.waitForTimeout(800);
  ok(JSON.stringify(await tabs(guest)) === JSON.stringify(['Sign in']) && /New accounts are closed right now\. Ask the admin for an account\./.test(await guest.innerText('body')), 'sign-ups closed: only Sign in, and the page says so');
  ok(/You've been invited to a Live Challenge \(K7M2QX\)/.test(await guest.innerText('body')), 'a Live link: the invitation is shown');
  await submit(guest, 'sam_01', 'secret1');
  ok(!(await onLogin(guest)) && new URL(guest.url()).pathname === '/live/K7M2QX', 'after signing in the same address stays: ' + new URL(guest.url()).pathname);
  await guest.screenshot({ path: `${OUT}/shot-signin.png`, fullPage: true });

  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});

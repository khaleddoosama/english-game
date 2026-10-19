// Signing in, signing up and signing out in a real browser, with the app built for online mode (Supabase settings
// pointing at a made-up address) and a fake Supabase answered by this spec: the auth endpoints, the profile row, app
// settings, register_player, and empty answers for the game's own data. Made-up accounts; no real server is reached.
// What it proves: the login page, its messages, the session kept across a reload, the offline start with the cached
// profile, the Admin tab for the admin only, and signing out. NOT proven: the real Supabase Auth or database (their
// rules: supabase/tests/signup_limits.sql). Docs: docs/modules/accounts/sign-in.md.
const fs = require('node:fs');
const path = require('node:path');
const { ok, launch, run, OUT, ROOT } = require('../helpers.cjs');

const APP = 'https://wh.test';
const SB = 'https://fakebase.supabase.test';
const DIST = path.join(OUT, 'online-app');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const uid = (n) => `00000000-0000-4000-8000-00000000000${n}`;

// The fake server's state: the accounts, the settings, and switches a check can turn.
const server = {
  accounts: { sam_01: { id: uid(1), password: 'secret1', role: 'player' }, ada_admin: { id: uid(2), password: 'secret2', role: 'admin' } },
  settings: { signupsOpen: true },
  profileDown: false,
  calls: [],
};
const userOf = (name) => ({ id: server.accounts[name].id, aud: 'authenticated', role: 'authenticated', email: `${name}@wordhunter.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
const nameOf = (id) => Object.keys(server.accounts).find((n) => server.accounts[n].id === id);

async function serve(context) {
  await context.route(APP + '/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/_vercel/')) return route.fulfill({ status: 404, body: '' });
    let file = path.join(DIST, decodeURIComponent(u.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await context.route(SB + '/**', (route) => {
    const r = route.request(); const u = new URL(r.url());
    const body = r.postData() ? JSON.parse(r.postData()) : null;
    server.calls.push(`${r.method()} ${u.pathname}`);
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (u.pathname === '/auth/v1/token') {
      const name = String(body.email).replace(/@wordhunter\.test$/, '');
      const account = server.accounts[name];
      if (body.password === 'too-many') return json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
      if (!account || account.password !== body.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: `token-${name}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${name}`, user: userOf(name) });
    }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/rest/v1/profiles') {
      if (server.profileDown) return route.abort('internetdisconnected');
      const name = nameOf(u.searchParams.get('id').replace(/^eq\./, ''));
      return json(200, { id: server.accounts[name].id, username: name, role: server.accounts[name].role });
    }
    if (u.pathname === '/rest/v1/app_settings') return json(200, { data: server.settings });
    if (u.pathname === '/rest/v1/rpc/register_player') {
      if (server.accounts[body.p_username]) return json(400, { code: 'P0001', message: 'That username is taken', details: null, hint: null });
      server.accounts[body.p_username] = { id: uid(Object.keys(server.accounts).length + 1), password: body.p_password, role: 'player' };
      return route.fulfill({ status: 204, body: '' });
    }
    if (u.pathname === '/rest/v1/rpc/social_counts') return json(200, { requests: 0, invites: 0 });
    if (u.pathname === '/rest/v1/rpc/live_view') return json(400, { code: 'P0001', message: 'No challenge with that code.', details: null, hint: null });
    // The game's own data: nothing saved yet.
    return json(200, r.method() === 'GET' || u.pathname.startsWith('/rest/v1/rpc/') ? [] : null);
  });
}

const field = (page, kind) => page.locator(kind === 'user' ? 'input[autocomplete="username"]' : 'input[type="password"]');
const message = async (page) => { const el = page.locator('.auth-error'); return (await el.count()) ? (await el.innerText()).trim() : ''; };
const submit = async (page, user, password) => {
  await field(page, 'user').fill(user); await field(page, 'password').fill(password);
  await page.click('button.auth-submit');
  // done when the button is usable again (an error) or the login page is gone and the game's header is up
  await page.waitForFunction(() => { const b = document.querySelector('button.auth-submit'); return b ? !b.disabled : !!document.querySelector('.wh-sub'); }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
};
const onLogin = async (page) => (await page.locator('form.auth-card').count()) > 0;
const header = async (page) => ((await page.locator('.wh-sub').count()) ? (await page.locator('.wh-sub').innerText()) : '');
const tabs = async (page) => page.locator('.auth-tabs [role="tab"]').allInnerTexts();
// Past the splash: the login page or the game's header (the profile read is retried, so this can take a few seconds).
const settled = (page) => page.waitForFunction(() => document.querySelector('form.auth-card') || document.querySelector('.wh-sub'), null, { timeout: 20000 });

run(async () => {
  // The app as an online deployment builds it, pointing at the fake server.
  const { build } = await import('vite');
  process.env.VITE_SUPABASE_URL = SB; process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
  await build({ root: ROOT, logLevel: 'silent', build: { outDir: DIST, emptyOutDir: true } });

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

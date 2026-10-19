// The app built for online mode and a fake Supabase that the spec answers itself, for specs that need the login
// page and the account flows (local mode has no accounts). Made-up accounts; no real server is reached.
//   const fake = createFakeSupabase();  await fake.build(dir);  await fake.serve(context, dir);
// fake.state: accounts, settings, switches (profileDown, holdMs per path, reply per path) and the calls seen.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers.cjs');

const APP = 'https://wh.test';
const SB = 'https://fakebase.supabase.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function createFakeSupabase() {
  const state = {
    accounts: { sam_01: { id: uid(1), password: 'secret1', role: 'player' }, ada_admin: { id: uid(2), password: 'secret2', role: 'admin' } },
    settings: { signupsOpen: true },
    profileDown: false,
    holdMs: {},   // path -> wait this long before answering
    reply: {},    // path -> { status, body } instead of the usual answer
    calls: [],    // "METHOD /path" in the order the requests came
    log: [],      // { at, what, body } with times, for order checks
  };
  const userOf = (name) => ({ id: state.accounts[name].id, aud: 'authenticated', role: 'authenticated', email: `${name}@wordhunter.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
  const nameOf = (id) => Object.keys(state.accounts).find((n) => state.accounts[n].id === id);

  // The app as an online deployment builds it, pointing at the fake server.
  async function build(dir) {
    const { build: viteBuild } = await import('vite');
    process.env.VITE_SUPABASE_URL = SB; process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
    await viteBuild({ root: ROOT, logLevel: 'silent', build: { outDir: dir, emptyOutDir: true } });
  }

  async function serve(context, dir) {
    await context.route(APP + '/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/_vercel/')) return route.fulfill({ status: 404, body: '' });
      let file = path.join(dir, decodeURIComponent(u.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await context.route(SB + '/**', async (route) => {
      const r = route.request(); const u = new URL(r.url());
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      state.calls.push(`${r.method()} ${u.pathname}`);
      state.log.push({ at: Date.now(), what: `${r.method()} ${u.pathname}`, body });
      const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (state.holdMs[u.pathname]) await pause(state.holdMs[u.pathname]);
      const answered = () => state.log.push({ at: Date.now(), what: `answered ${u.pathname}` });
      try {
        if (state.reply[u.pathname]) { const { status, body: data } = state.reply[u.pathname]; return await (data === undefined ? route.fulfill({ status, body: '' }) : json(status, data)); }
        if (u.pathname === '/auth/v1/token') {
          const name = String(body.email).replace(/@wordhunter\.test$/, '');
          const account = state.accounts[name];
          if (body.password === 'too-many') return await json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
          if (!account || account.password !== body.password) return await json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return await json(200, { access_token: `token-${name}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${name}`, user: userOf(name) });
        }
        if (u.pathname === '/auth/v1/logout') return await route.fulfill({ status: 204, body: '' });
        if (u.pathname === '/auth/v1/user' && r.method() === 'PUT') {
          const name = Object.keys(state.accounts).find((n) => r.headers().authorization === `Bearer token-${n}`);
          if (name && body.password) state.accounts[name].password = body.password;
          return await json(200, userOf(name || 'sam_01'));
        }
        if (u.pathname === '/rest/v1/profiles') {
          if (state.profileDown) return await route.abort('internetdisconnected');
          const name = nameOf(u.searchParams.get('id').replace(/^eq\./, ''));
          return await json(200, { id: state.accounts[name].id, username: name, role: state.accounts[name].role });
        }
        if (u.pathname === '/rest/v1/app_settings') return await json(200, { data: state.settings });
        if (u.pathname === '/rest/v1/rpc/register_player') {
          if (state.accounts[body.p_username]) return await json(400, { code: 'P0001', message: 'That username is taken', details: null, hint: null });
          state.accounts[body.p_username] = { id: uid(Object.keys(state.accounts).length + 1), password: body.p_password, role: 'player' };
          return await route.fulfill({ status: 204, body: '' });
        }
        if (u.pathname === '/rest/v1/rpc/social_counts') return await json(200, { requests: 0, invites: 0 });
        if (u.pathname === '/rest/v1/rpc/live_view') return await json(400, { code: 'P0001', message: 'No challenge with that code.', details: null, hint: null });
        // The game's own data: nothing saved yet.
        return await json(200, r.method() === 'GET' || u.pathname.startsWith('/rest/v1/rpc/') ? [] : null);
      } finally { answered(); }
    });
  }
  return { APP, SB, state, build, serve };
}

// Page helpers for the login page and the game's header.
const field = (page, kind) => page.locator(kind === 'user' ? 'input[autocomplete="username"]' : 'input[type="password"]');
const loginMessage = async (page) => { const el = page.locator('.auth-error'); return (await el.count()) ? (await el.innerText()).trim() : ''; };
async function submitLogin(page, user, password) {
  await field(page, 'user').fill(user); await field(page, 'password').fill(password);
  await page.click('button.auth-submit');
  // done when the button is usable again (an error) or the login page is gone (the game, or a screen before it)
  await page.waitForFunction(() => { const b = document.querySelector('button.auth-submit'); return b ? !b.disabled : !!(document.querySelector('.wh-sub') || document.querySelector('.splash .load-error')); }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}
const onLogin = async (page) => (await page.locator('form.auth-card').count()) > 0;
const header = async (page) => ((await page.locator('.wh-sub').count()) ? (await page.locator('.wh-sub').innerText()) : '');
// Past the splash: the login page or the game's header (the profile read is retried, so this can take a few seconds).
const settled = (page) => page.waitForFunction(() => document.querySelector('form.auth-card') || document.querySelector('.wh-sub'), null, { timeout: 20000 });

module.exports = { createFakeSupabase, uid, field, loginMessage, submitLogin, onLogin, header, settled };

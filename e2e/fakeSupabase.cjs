// The app built for online mode and a fake Supabase that the spec answers itself, for specs that need the login
// page and the account flows (local mode has no accounts). Made-up accounts; no real server is reached.
//   const fake = createFakeSupabase();  await fake.build(dir);  await fake.serve(context, dir);
// fake.state: accounts, settings, switches (profileDown, holdMs per path, reply per path, down per path) and the calls
// seen. Social specs also use: an account's `stats` (its leaderboard numbers), `pairs` (friendships and requests, by
// username), `invites` (Live invitations waiting, for the badges) and `liveResults` (rows of live_results). `content`
// ({ levelOrder, words, grammar }) is the shared course the game loads; without it there is none.
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
    log: [],      // { at, what, body, query } with times, for order checks
    down: {},     // path -> the request fails as if the network were down
    pairs: [],    // { a, b, by, status: "pending" | "accepted" | "declined" | "removed" | "cancelled" } (usernames)
    invites: 0,   // Live invitations waiting for each player (social_counts)
    liveResults: [], // rows of live_results (user_id, room_code, title, …)
    content: null,   // { levelOrder, words, grammar }: the course in content_meta and content_items
  };
  const userOf = (name) => ({ id: state.accounts[name].id, aud: 'authenticated', role: 'authenticated', email: `${name}@wordhunter.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
  const nameOf = (id) => Object.keys(state.accounts).find((n) => state.accounts[n].id === id);
  // A profile row as the leaderboard reads it: zeros unless the account has `stats`.
  const profileRow = (name) => ({ id: state.accounts[name].id, username: name, score: 0, week_score: 0, week_start: null, mastered_count: 0, study_streak: 0, best_study_streak: 0, live_wins: 0, live_played: 0, ...state.accounts[name].stats });
  const pairOf = (x, y) => state.pairs.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
  const other = (p, me) => (p.a === me ? p.b : p.a);
  const refuse = (message, code) => ({ status: 400, body: { code, message, details: null, hint: null } });

  // The friends functions of migrations 0024/0025, for the signed-in account `me` (the rules the social specs use).
  function friendsRpc(fn, me, body) {
    const mine = state.pairs.filter((p) => p.a === me || p.b === me);
    if (fn === 'friends_list') {
      return { status: 200, body: {
        friends: mine.filter((p) => p.status === 'accepted').map((p) => ({ ...profileRow(other(p, me)), since: '2026-10-01T00:00:00Z' })).sort((x, y) => x.username.localeCompare(y.username)),
        incoming: mine.filter((p) => p.status === 'pending' && p.by !== me).map((p) => ({ id: state.accounts[p.by].id, username: p.by, at: '2026-10-02T00:00:00Z' })),
        outgoing: mine.filter((p) => p.status === 'pending' && p.by === me).map((p) => ({ id: state.accounts[other(p, me)].id, username: other(p, me), at: '2026-10-02T00:00:00Z' })),
      } };
    }
    if (fn === 'social_counts') return { status: 200, body: { requests: mine.filter((p) => p.status === 'pending' && p.by !== me).length, invites: state.invites } };
    if (fn === 'friend_request') {
      const name = String(body.p_username || '').trim().toLowerCase();
      if (!state.accounts[name]) return refuse(`No player is called "${name}". Check the spelling.`, 'P0002');
      if (name === me) return refuse('That is you.', '22023');
      const p = pairOf(me, name);
      if (p?.status === 'accepted') return refuse(`You are already friends with ${name}.`, '55000');
      if (p?.status === 'pending' && p.by === me) return refuse(`You already asked ${name}. Waiting for them to answer.`, '55000');
      if (p?.status === 'pending') { p.status = 'accepted'; return { status: 200, body: { status: 'accepted', id: state.accounts[name].id, username: name } }; }
      if (p) Object.assign(p, { by: me, status: 'pending' }); else state.pairs.push({ a: me, b: name, by: me, status: 'pending' });
      return { status: 200, body: { status: 'pending', id: state.accounts[name].id, username: name } };
    }
    if (fn === 'friend_respond') {
      const p = pairOf(me, nameOf(body.p_user));
      if (!p || p.status !== 'pending' || p.by === me) return refuse('There is no request from this player.', 'P0002');
      p.status = body.p_accept ? 'accepted' : 'declined';
      return { status: 204 };
    }
    if (fn === 'friend_remove') {
      const p = pairOf(me, nameOf(body.p_user));
      if (p?.status === 'accepted') p.status = 'removed'; else if (p?.status === 'pending' && p.by === me) p.status = 'cancelled';
      return { status: 204 };
    }
    return null;
  }

  // Enough of PostgREST's reading for the leaderboard and the Live history: eq, gt, in, order, limit.
  function select(rows, params) {
    let out = rows;
    for (const [col, v] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
      const [op, ...rest] = v.split('.'); const val = rest.join('.');
      if (op === 'eq') out = out.filter((r) => String(r[col]) === val);
      else if (op === 'gt') out = out.filter((r) => Number(r[col]) > Number(val));
      else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[col]))); }
    }
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map((o) => o.split('.'));
      out = out.slice().sort((x, y) => { for (const [col, dir] of keys) { if (x[col] !== y[col]) return (x[col] < y[col] ? -1 : 1) * (dir === 'desc' ? -1 : 1); } return 0; });
    }
    return params.get('limit') ? out.slice(0, Number(params.get('limit'))) : out;
  }

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
      state.log.push({ at: Date.now(), what: `${r.method()} ${u.pathname}`, body, query: u.search });
      const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (state.holdMs[u.pathname]) await pause(state.holdMs[u.pathname]);
      if (state.down[u.pathname]) { state.log.push({ at: Date.now(), what: `answered ${u.pathname}` }); return route.abort('internetdisconnected'); }
      const me = Object.keys(state.accounts).find((n) => r.headers().authorization === `Bearer token-${n}`);
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
        if (u.pathname === '/rest/v1/profiles' && !/^eq\./.test(u.searchParams.get('id') || '')) return await json(200, select(Object.keys(state.accounts).map(profileRow), u.searchParams));
        if (u.pathname === '/rest/v1/live_results') return await json(200, select(state.liveResults, u.searchParams));
        if (u.pathname === '/rest/v1/content_meta' && state.content) return await json(200, { version: 1, level_order: state.content.levelOrder, note: '' });
        if (u.pathname === '/rest/v1/content_items' && state.content) {
          const rows = [...(state.content.words || []).map((w) => ['words', w.word, w]), ...(state.content.grammar || []).map((g) => ['grammar', g.id, g])];
          return await json(200, rows.map(([kind, key, data], i) => ({ kind, key, data, position: (i + 1) * 1000, deleted: false, updated_at: '2026-10-01T00:00:00Z' })));
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
        const fn = u.pathname.startsWith('/rest/v1/rpc/') && me ? friendsRpc(u.pathname.slice('/rest/v1/rpc/'.length), me, body || {}) : null;
        if (fn) return await (fn.body === undefined ? route.fulfill({ status: fn.status, body: '' }) : json(fn.status, fn.body));
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

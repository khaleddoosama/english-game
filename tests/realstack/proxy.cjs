/* global process, console */
// Routes what supabase-js sends (/auth/v1, /rest/v1) to GoTrue and PostgREST, as a project's gateway does.
//   node tests/realstack/proxy.cjs            listens on 54330; GoTrue on 54332, PostgREST on 54333
const http = require('node:http');
const ROUTES = [['/auth/v1', 54332], ['/rest/v1', 54333]];
http.createServer((req, res) => {
  const hit = ROUTES.find(([prefix]) => req.url.startsWith(prefix));
  if (!hit) { res.writeHead(404); res.end('no route'); return; }
  const [prefix, port] = hit;
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url.slice(prefix.length) || '/', headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e.message)); });
  req.pipe(up);
}).listen(Number(process.env.PROXY_PORT || 54330), '127.0.0.1', () => console.log('gateway on', process.env.PROXY_PORT || 54330));

/* global process, console, URL */
// Routes what supabase-js sends to the services, as a project's gateway does: /auth/v1 to GoTrue, /rest/v1 to
// PostgREST, and /realtime/v1 (HTTP and the WebSocket) to Realtime's /socket, with the Host header naming the tenant
// "realtime-dev" (the one Realtime seeds when it runs self-hosted).
// With STATIC_DIR set it also serves the built app from that folder (any other path; unknown paths get index.html), so
// the browser specs open the app from the same address as the API.
//   node tests/realstack/proxy.cjs            listens on 54330; GoTrue on 54332, PostgREST on 54333, Realtime on 4000
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const STATIC_DIR = process.env.STATIC_DIR;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveStatic(req, res) {
  const clean = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let file = path.join(STATIC_DIR, clean);
  if (!file.startsWith(path.resolve(STATIC_DIR)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
const ROUTES = [['/auth/v1', 54332, ''], ['/rest/v1', 54333, ''], ['/realtime/v1', 4000, '/socket']];
const TENANT_HOST = 'realtime-dev.localhost';
const route = (url) => {
  const hit = ROUTES.find(([prefix]) => url.startsWith(prefix));
  if (!hit) return null;
  const [prefix, port, base] = hit;
  return { port, path: base + (url.slice(prefix.length) || '/'), realtime: prefix === '/realtime/v1' };
};

const server = http.createServer((req, res) => {
  const r = route(req.url);
  if (!r && STATIC_DIR) { serveStatic(req, res); return; }
  if (!r) { res.writeHead(404); res.end('no route'); return; }
  const headers = r.realtime ? { ...req.headers, host: TENANT_HOST } : req.headers;
  const up = http.request({ host: '127.0.0.1', port: r.port, method: req.method, path: r.path, headers }, (u) => { res.writeHead(u.statusCode, u.headers); u.pipe(res); });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e.message)); });
  req.pipe(up);
});

// WebSocket: replay the upgrade request to the service (path and Host rewritten), then join the two sockets.
server.on('upgrade', (req, socket, head) => {
  const r = route(req.url);
  if (!r) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
  const up = net.connect(r.port, '127.0.0.1', () => {
    const lines = [`${req.method} ${r.path} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(`${name}: ${r.realtime && name.toLowerCase() === 'host' ? TENANT_HOST : req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const close = () => { socket.destroy(); up.destroy(); };
  up.on('error', close); socket.on('error', close);
});

server.listen(Number(process.env.PROXY_PORT || 54330), '127.0.0.1', () => console.log('gateway on', process.env.PROXY_PORT || 54330));

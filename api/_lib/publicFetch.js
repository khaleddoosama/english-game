// Downloads from the public internet only (review F11). Every address the
// server connects to is checked, including each redirect and what a name
// resolves to at connect time, so a link can't reach the server's own
// network (loopback, private ranges, cloud metadata at 169.254.x.x...).
// The body is read with a byte cap and abandoned as soon as it's too big.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
]) blocked.addSubnet(address, prefix, "ipv6");

// IPv4-mapped IPv6 (::ffff:127.0.0.1) is checked against the IPv4 ranges.
export function isPrivateAddress(address) {
  const ip = String(address || "").replace(/^\[|\]$/g, "");
  const type = net.isIP(ip);
  if (!type) return true;
  return blocked.check(ip, type === 4 ? "ipv4" : "ipv6");
}

export class FetchRefused extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// -> { status, type, body: Buffer }. Throws FetchRefused with a status for
// the reply (400 a link we won't open, 413 too big, 502 the other side).
export async function fetchPublic(link, { maxBytes, timeoutMs = 10000, maxRedirects = 3, headers = {}, allowAddress = (a) => !isPrivateAddress(a) } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = parse(link);
  for (let hop = 0; ; hop++) {
    const res = await open(url, { signal, headers, allowAddress });
    if (REDIRECTS.has(res.statusCode) && res.headers.location) {
      res.resume();
      if (hop >= maxRedirects) throw new FetchRefused("That link redirects too many times.", 502);
      url = parse(new URL(res.headers.location, url).href);
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); throw new FetchRefused(`That link answered ${res.statusCode}.`, 502); }
    const length = Number(res.headers["content-length"]);
    if (Number.isFinite(length) && length > maxBytes) { res.destroy(); throw new FetchRefused("too big", 413); }
    const body = await readCapped(res, maxBytes);
    return { status: res.statusCode, type: String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase(), body };
  }
}

function parse(link) {
  let url;
  try { url = new URL(link); } catch { throw new FetchRefused("That isn't a valid link.", 400); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchRefused("The link must start with http:// or https://", 400);
  if (url.username || url.password) throw new FetchRefused("Links with a user name or password aren't allowed.", 400);
  return url;
}

function open(url, { signal, headers, allowAddress }) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // An address written in the link never goes through the lookup below.
  if (net.isIP(host) && !allowAddress(host)) return Promise.reject(new FetchRefused("That link points to a private network address.", 400));
  // Checked when connecting, so a name can't resolve to one address here
  // and another one there.
  const lookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const bad = addresses.find((a) => !allowAddress(a.address));
      if (bad) return callback(new FetchRefused("That link points to a private network address.", 400));
      if (options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
  const get = url.protocol === "https:" ? https.get : http.get;
  return new Promise((resolve, reject) => {
    const req = get(url, { headers, lookup, signal }, resolve);
    req.on("error", (e) => reject(e instanceof FetchRefused ? e : e.name === "AbortError" || e.code === "ABORT_ERR" ? new FetchRefused("That link took too long to answer.", 502) : new FetchRefused("Couldn't download that picture (timed out or blocked).", 502)));
  });
}

function readCapped(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const cutOff = () => finish(reject, new FetchRefused("The download was cut off.", 502));
    res.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { finish(reject, new FetchRefused("too big", 413)); res.destroy(); return; }
      chunks.push(chunk);
    });
    res.on("end", () => finish(resolve, Buffer.concat(chunks)));
    res.on("error", cutOff);
    res.on("aborted", cutOff);
  });
}

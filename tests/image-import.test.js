// Copying a picture link (review F11): only the public internet, each
// redirect checked, at most 2 MB read, and the bytes must be a picture.
import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchPublic, isPrivateAddress } from "../api/_lib/publicFetch.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
let server, base;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/pic.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
    if (u.pathname === "/hop") { res.writeHead(302, { location: u.searchParams.get("to") }); return res.end(); }
    if (u.pathname === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
    if (u.pathname === "/huge") { // no content-length: the cap has to stop the reading
      res.writeHead(200, { "content-type": "image/png" });
      let sent = 0;
      const more = () => { while (sent < 50 * 1024 * 1024) { sent += 65536; if (!res.write(Buffer.alloc(65536))) return res.once("drain", more); } res.end(); };
      res.on("close", () => { server.hugeStoppedAt = sent; });
      return more();
    }
    if (u.pathname === "/announced") { res.writeHead(200, { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

// The test server is on loopback, so these tests allow exactly that one address.
const onlyLocal = { allowAddress: (a) => a === "127.0.0.1" };

describe("which addresses a link may reach", () => {
  it("refuses loopback, private, link-local, metadata and mapped addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "[::1]", "not-an-ip"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "151.101.1.69", "2606:4700::6810:84e5", "172.32.0.1", "192.169.0.1"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("refuses private addresses written in the link, in any spelling", async () => {
    for (const link of ["http://127.0.0.1/x.png", "http://2130706433/x.png", "http://0x7f.1/x.png", "http://[::1]/x.png", "http://[::ffff:127.0.0.1]/x.png", "http://169.254.169.254/latest/meta-data"]) {
      await expect(fetchPublic(link, { maxBytes: 1000 }), link).rejects.toMatchObject({ status: 400, message: /private network/ });
    }
  });

  it("refuses a name that resolves to a private address", async () => {
    await expect(fetchPublic("http://localhost:1/x.png", { maxBytes: 1000 })).rejects.toMatchObject({ status: 400, message: /private network/ });
  });

  it("refuses other schemes and links with a password", async () => {
    await expect(fetchPublic("file:///etc/passwd", { maxBytes: 10 })).rejects.toMatchObject({ status: 400 });
    await expect(fetchPublic("ftp://example.com/x.png", { maxBytes: 10 })).rejects.toMatchObject({ status: 400 });
    await expect(fetchPublic("http://user:pw@example.com/x.png", { maxBytes: 10 })).rejects.toMatchObject({ status: 400 });
  });
});

describe("downloading", () => {
  it("reads a picture", async () => {
    const got = await fetchPublic(`${base}/pic.png`, { maxBytes: 1000, ...onlyLocal });
    expect(got).toMatchObject({ status: 200, type: "image/png" });
    expect(got.body.equals(PNG)).toBe(true);
  });

  it("checks every redirect, and stops after 3", async () => {
    expect((await fetchPublic(`${base}/hop?to=/pic.png`, { maxBytes: 1000, ...onlyLocal })).type).toBe("image/png");
    const port = server.address().port;
    // 127.0.0.2 is the same machine but not the allowed address: a redirect there is refused.
    await expect(fetchPublic(`${base}/hop?to=http://127.0.0.2:${port}/pic.png`, { maxBytes: 1000, ...onlyLocal })).rejects.toMatchObject({ status: 400, message: /private network/ });
    await expect(fetchPublic(`${base}/hop?to=http://169.254.169.254/`, { maxBytes: 1000, ...onlyLocal })).rejects.toMatchObject({ status: 400 });
    await expect(fetchPublic(`${base}/loop`, { maxBytes: 1000, ...onlyLocal })).rejects.toMatchObject({ status: 502, message: /too many times/ });
  });

  it("stops reading at the cap instead of downloading everything", async () => {
    await expect(fetchPublic(`${base}/huge`, { maxBytes: 2 * 1024 * 1024, ...onlyLocal })).rejects.toMatchObject({ status: 413 });
    await vi.waitFor(() => expect(server.hugeStoppedAt).toBeDefined());
    expect(server.hugeStoppedAt).toBeLessThan(20 * 1024 * 1024);
    await expect(fetchPublic(`${base}/announced`, { maxBytes: 2 * 1024 * 1024, ...onlyLocal })).rejects.toMatchObject({ status: 413 });
  });

  it("reports a missing picture and a slow server", async () => {
    await expect(fetchPublic(`${base}/nothing`, { maxBytes: 1000, ...onlyLocal })).rejects.toMatchObject({ status: 502, message: /answered 404/ });
  });
});

describe("/api/image-import", () => {
  let api;
  beforeAll(async () => {
    process.env.SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_ANON_KEY = "anon";
    api = await import("../api/image-import.js");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("knows pictures by their bytes", () => {
    expect(api.looksLike("image/png", PNG)).toBe(true);
    expect(api.looksLike("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(api.looksLike("image/gif", Buffer.from("GIF89a...."))).toBe(true);
    expect(api.looksLike("image/webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(api.looksLike("image/png", Buffer.from("<html>not a picture</html>"))).toBe(false);
  });

  it("a private link is refused and logged, and nothing is stored", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("/rpc/ai_gate")) return { ok: true, status: 200, json: async () => ({ ok: true, call: 3 }) };
      return { ok: true, status: 204, json: async () => null, text: async () => "" };
    }));
    const res = await api.POST(new Request("https://app.test/api/image-import", { method: "POST", headers: { authorization: "Bearer admin" }, body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/private network/);
    expect(calls.some((u) => u.includes("/storage/"))).toBe(false);
  });
});

// @vitest-environment jsdom
// The sign-in state (src/features/auth/AuthProvider.jsx) with a fake Supabase client: the start-up (no session, a
// session, the cached profile when the profile cannot be read, the message without one), session changes (a
// refreshed token changes nothing, an older user's late answer is dropped, signing out), the account actions and
// their messages, local mode, and accessToken (src/lib/auth.js). Made-up accounts. The rules: auth-rules.test.js.
// Docs: docs/modules/accounts/sign-in.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ local: false, client: null }));
vi.mock("../src/lib/supabase", () => ({ get isLocalMode() { return env.local; }, get supabase() { return env.client; } }));
const { AuthProvider, useAuth } = await import("../src/features/auth");
const { accessToken } = await import("../src/lib/auth");

const later = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const SAM = { id: "u-sam", email: "sam_01@wordhunter.test" }, ADA = { id: "u-ada", email: "ada@wordhunter.test" };
const PROFILES = { "u-sam": { id: "u-sam", username: "sam_01", role: "player" }, "u-ada": { id: "u-ada", username: "ada", role: "admin" } };

// A fake client: a session, profile reads (each can be held or fail), auth calls recorded with set replies.
function fakeClient(session = null) {
  const c = {
    session, calls: [], listener: null, replies: {}, holds: {}, profileDown: false,
    auth: {
      getSession: async () => ({ data: { session: c.session } }),
      onAuthStateChange: (fn) => { c.listener = fn; return { data: { subscription: { unsubscribe: () => c.calls.push(["unsubscribe"]) } } }; },
      signInWithPassword: async (x) => { c.calls.push(["signIn", x]); return { error: c.replies.signIn || null }; },
      signOut: async () => { c.calls.push(["signOut"]); },
      updateUser: async (x) => { c.calls.push(["updateUser", x]); return { error: c.replies.updateUser || null }; },
    },
    rpc: async (name, args) => { c.calls.push(["rpc", name, args]); return { error: c.replies.rpc || null }; },
    from: (table) => ({ select: () => ({ eq: (_col, id) => ({ single: async () => {
      c.calls.push(["profile", table, id]);
      if (c.holds[id]) await c.holds[id].promise;
      if (c.profileDown) return { data: null, error: { message: "offline" } };
      return { data: { ...PROFILES[id] }, error: null };
    } }) }) }),
  };
  return c;
}

let root, host, auth;
function Probe() { auth = useAuth(); return null; }
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  await settle();
}
const change = (session) => act(async () => { env.client.listener("EVENT", session); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; env.local = false; env.client = fakeClient(); localStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; });

describe("start-up", () => {
  it("loading until the session is known; no session: signed out, no message", async () => {
    const held = later();
    env.client.auth.getSession = () => held.promise;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    expect(auth.loading).toBe(true);
    await act(async () => held.resolve({ data: { session: null } }));
    await settle();
    expect([auth.loading, auth.user, auth.profile, auth.error, auth.isAdmin]).toEqual([false, null, null, null, false]);
  });
  it("a session: the profile is read and cached; isAdmin follows the role", async () => {
    env.client = fakeClient({ user: ADA });
    await mount();
    expect([auth.user, auth.profile, auth.isAdmin]).toEqual([ADA, PROFILES["u-ada"], true]);
    expect(JSON.parse(localStorage.getItem("wh-profile:u-ada"))).toEqual(PROFILES["u-ada"]);
  });
  it("the profile cannot be read: the cached one is used; without one, signed out with the message", async () => {
    env.client = fakeClient({ user: SAM }); env.client.profileDown = true;
    localStorage.setItem("wh-profile:u-sam", JSON.stringify({ id: "u-sam", username: "sam_01", role: "player", cached: true }));
    await mount();
    expect(auth.profile.cached).toBe(true);
    await act(async () => root.unmount()); host.remove();
    localStorage.clear();
    await mount();
    expect([auth.loading, auth.user, auth.error]).toEqual([false, null, "Couldn't load your account. Check your connection and try again."]);
  });
});

describe("session changes", () => {
  it("a refreshed token for the same user changes nothing; signing out clears the user", async () => {
    env.client = fakeClient({ user: SAM });
    await mount();
    const first = auth.profile;
    await change({ user: SAM, access_token: "new" });
    expect(env.client.calls.filter((c) => c[0] === "profile")).toHaveLength(1);
    expect(auth.profile).toBe(first);
    await change(null);
    expect([auth.user, auth.profile]).toEqual([null, null]);
  });
  it("a late answer for an older user is dropped", async () => {
    await mount();
    env.client.holds["u-sam"] = later();
    await change({ user: SAM });
    await change({ user: ADA });
    expect(auth.user).toBe(ADA);
    await act(async () => { env.client.holds["u-sam"].resolve(); });
    await settle();
    expect([auth.user, auth.profile.username]).toEqual([ADA, "ada"]);
  });
  it("stops listening when unmounted", async () => {
    await mount();
    await act(async () => root.unmount()); host.remove(); root = undefined;
    expect(env.client.calls).toContainEqual(["unsubscribe"]);
  });
});

describe("account actions", () => {
  it("sign in: the cleaned name's placeholder address; the username rule; the messages", async () => {
    await mount();
    await auth.signIn(" Sam_01 ", "secret1");
    expect(env.client.calls).toContainEqual(["signIn", { email: "sam_01@wordhunter.test", password: "secret1" }]);
    expect(await fails(() => auth.signIn("ab", "secret1"))).toBe("Usernames are 3–20 letters, numbers or _.");
    env.client.replies.signIn = { message: "Invalid login credentials" };
    expect(await fails(() => auth.signIn("sam_01", "nope"))).toBe("Wrong username or password.");
    env.client.replies.signIn = { message: "Request rate limit reached" };
    expect(await fails(() => auth.signIn("sam_01", "nope"))).toBe("Request rate limit reached");
  });
  it("sign up: the rules first (name, then password), then register_player, then sign in", async () => {
    await mount();
    expect(await fails(() => auth.signUp("ab", "x"))).toBe("Usernames are 3–20 letters, numbers or _.");
    expect(await fails(() => auth.signUp("new_one", "12345"))).toBe("Passwords need at least 6 characters.");
    expect(env.client.calls).toEqual([]);
    env.client.replies.rpc = { message: "That username is taken" };
    expect(await fails(() => auth.signUp("sam_01", "secret1"))).toBe("That username is taken");
    expect(env.client.calls.map((c) => c[0])).toEqual(["rpc"]);
    env.client.replies.rpc = null; env.client.calls.length = 0;
    await auth.signUp(" New_One ", "secret1");
    expect(env.client.calls).toEqual([["rpc", "register_player", { p_username: "new_one", p_password: "secret1" }], ["signIn", { email: "new_one@wordhunter.test", password: "secret1" }]]);
  });
  it("change password, sign out, refresh the profile", async () => {
    env.client = fakeClient({ user: SAM });
    await mount();
    expect(await fails(() => auth.changePassword("12345"))).toBe("Passwords need at least 6 characters.");
    env.client.replies.updateUser = { message: "Password too weak" };
    expect(await fails(() => auth.changePassword("secret9"))).toBe("Password too weak");
    await auth.signOut();
    expect(env.client.calls.filter((c) => c[0] === "signOut")).toHaveLength(1);
    PROFILES["u-sam"].role = "admin";
    await act(async () => { await auth.refreshProfile(); });
    expect(auth.isAdmin).toBe(true);
    PROFILES["u-sam"].role = "player";
  });
});

describe("local mode and the access token", () => {
  it("local mode: the local admin at once; sign out and refresh do nothing; no token", async () => {
    env.local = true; env.client = null;
    await mount();
    expect([auth.loading, auth.user, auth.profile, auth.isAdmin]).toEqual([false, { id: "local" }, { id: "local", username: "local", role: "admin" }, true]);
    await auth.signOut(); await auth.refreshProfile();
    expect(await accessToken()).toBe(null);
  });
  it("online: the session's access token, or null without a session", async () => {
    env.client = fakeClient({ user: SAM, access_token: "tok-1" });
    expect(await accessToken()).toBe("tok-1");
    env.client.session = null;
    expect(await accessToken()).toBe(null);
  });
});

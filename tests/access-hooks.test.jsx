// @vitest-environment jsdom
// Access (src/features/auth): signing out after the saves (useSignOut: waiting saves run at once, running ones are
// waited for, but not more than 5 s; one sign-out at a time; a failure says why and the player stays), the
// maintenance screen, and the Profile page's password form (with a fake useAuth). Made-up data. Docs:
// docs/modules/accounts/sign-in.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ changePassword: null }));
vi.mock("../src/features/auth/AuthProvider", () => ({ AuthProvider: ({ children }) => children, useAuth: () => auth }));
const { ChangePassword, MaintenanceScreen, useSignOut } = await import("../src/features/auth");

const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
let root, host, api, props;
function Probe() { api = useSignOut(props); return null; }
const mount = async (el) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(el)); };
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; vi.useRealTimers(); });

describe("signing out", () => {
  const setup = () => {
    const order = [];
    props = {
      onSignOut: vi.fn(async () => { order.push("signOut"); }),
      saves: { pendingSavesRef: { current: { progress: vi.fn(() => order.push("waiting save run")) } }, runningSavesRef: { current: {} } },
      setToast: vi.fn(),
    };
    return order;
  };
  it("without a sign-out (local mode) nothing happens", async () => {
    setup(); props.onSignOut = null;
    await mount(<Probe />);
    await act(async () => { await api.logOut(); });
    expect([api.loggingOut, props.saves.pendingSavesRef.current.progress.mock.calls.length]).toEqual([false, 0]);
  });
  it("runs the waiting saves at once, waits for the running ones, then signs out", async () => {
    const order = setup();
    const running = later();
    props.saves.runningSavesRef.current = { content: running.promise.then(() => order.push("running save done")) };
    await mount(<Probe />);
    let done;
    await act(async () => { done = api.logOut(); });
    expect(api.loggingOut).toBe(true);
    expect(order).toEqual(["waiting save run"]);
    await act(async () => { running.resolve(); await done; });
    expect(order).toEqual(["waiting save run", "running save done", "signOut"]);
  });
  it("a failed save does not stop it; a save that never ends is waited for 5 seconds", async () => {
    const order = setup();
    vi.useFakeTimers();
    const failed = Promise.reject(new Error("lost")); failed.catch(() => {});
    props.saves.runningSavesRef.current = { progress: failed, content: new Promise(() => {}) };
    await mount(<Probe />);
    await act(async () => { api.logOut(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(order).not.toContain("signOut");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(order).toContain("signOut");
  });
  it("one sign-out at a time", async () => {
    setup();
    const running = later();
    props.saves.runningSavesRef.current = { content: running.promise };
    await mount(<Probe />);
    await act(async () => { api.logOut(); });
    await act(async () => { api.logOut(); });
    await act(async () => { running.resolve(); });
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    expect(props.saves.pendingSavesRef.current.progress).toHaveBeenCalledTimes(1);
  });
  it("a failure says why, and the player can try again", async () => {
    setup();
    props.onSignOut = vi.fn(async () => { throw new Error("offline"); });
    await mount(<Probe />);
    await act(async () => { await api.logOut(); });
    expect(props.setToast).toHaveBeenCalledWith({ text: "Couldn't log out: offline" });
    expect(api.loggingOut).toBe(false);
  });
});

describe("the maintenance screen", () => {
  it("shows the message and a Try again button that reloads the page", async () => {
    const reload = vi.fn();
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, reload } });
    await mount(<MaintenanceScreen message="Back at noon." />);
    expect(host.querySelector(".load-error").textContent.trim()).toBe("Back at noon.");
    await act(async () => host.querySelector("button").click());
    expect(reload).toHaveBeenCalled();
    Object.defineProperty(window, "location", { configurable: true, value: real });
  });
});

describe("the password form", () => {
  const input = () => host.querySelector("input[type=password]"), button = () => host.querySelector("button");
  const type = (value) => act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = () => act(async () => { host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  it("Save is disabled under 6 characters; Saving… while it runs; done: cleared and said", async () => {
    const run = later();
    auth.changePassword = vi.fn(() => run.promise);
    await mount(<ChangePassword />);
    await type("12345");
    expect(button().disabled).toBe(true);
    await type("secret9");
    expect(button().disabled).toBe(false);
    await submit();
    expect([button().textContent, button().disabled]).toEqual(["Saving…", true]);
    expect(auth.changePassword).toHaveBeenCalledWith("secret9");
    await act(async () => run.resolve());
    expect([input().value, host.textContent.includes("Password changed.")]).toEqual(["", true]);
  });
  it("a refusal shows its message; typing clears it", async () => {
    auth.changePassword = vi.fn(async () => { throw new Error("Password too weak"); });
    await mount(<ChangePassword />);
    await type("secret9"); await submit();
    expect(host.querySelector(".wh-import-error").textContent).toBe("Password too weak");
    expect(input().value).toBe("secret9");
    await type("secret10");
    expect(host.querySelector(".wh-import-error")).toBe(null);
  });
});

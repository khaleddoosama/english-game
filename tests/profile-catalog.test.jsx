// @vitest-environment jsdom
// A player with no views at all can still reach the catalog, from Profile.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/auth", () => ({ useAuth: () => ({ user: null }) }));
import ProfilePage from "../src/features/social/ProfilePage.jsx";

let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.history.replaceState({}, "", "/profile"); });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const render = async (props) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ProfilePage stats={{}} {...props} />));
};

describe("Profile entries for the library", () => {
  it("shows Catalog and My library when the library is on, and opens the catalog", async () => {
    await render({ libraryOn: true });
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Catalog"));
    expect(btn).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent.includes("My library"))).toBe(true);
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.pathname).toBe("/catalog");
  });
  it("shows neither when the library is off", async () => {
    await render({ libraryOn: false });
    expect([...host.querySelectorAll("button")].some((b) => b.textContent.includes("Catalog"))).toBe(false);
  });
});

// The account rules with no state (src/features/auth/authRules.js): usernames, passwords, the placeholder email,
// the sign-in message, the local player and the profile cache key. Docs: docs/modules/accounts/sign-in.md.
import { describe, expect, it } from "vitest";
import * as A from "../src/features/auth/authRules.js";

describe("usernames", () => {
  it("are trimmed and lower-cased; nothing becomes empty text", () => {
    expect(A.cleanUsername("  Sam_01 ")).toBe("sam_01");
    expect([A.cleanUsername(null), A.cleanUsername(undefined), A.cleanUsername("")]).toEqual(["", "", ""]);
  });
  it("3 to 20 lower-case letters, digits or _; anything else has the one message", () => {
    for (const ok of ["abc", "sam_01", "x".repeat(20), "123", "___"]) expect(A.usernameProblem(ok), ok).toBe(null);
    for (const bad of ["ab", "x".repeat(21), "Sam", "bad name", "émile", "a-b", ""]) expect(A.usernameProblem(bad), bad).toBe("Usernames are 3–20 letters, numbers or _.");
  });
  it("map to a placeholder address on the .test domain", () => {
    expect(A.emailFor(" Sam_01 ")).toBe("sam_01@wordhunter.test");
  });
});

describe("passwords and messages", () => {
  it("a password needs at least 6 characters (spaces count)", () => {
    for (const ok of ["abcdef", "      ", "x".repeat(80)]) expect(A.passwordProblem(ok)).toBe(null);
    for (const bad of ["12345", "", null, undefined]) expect(A.passwordProblem(bad)).toBe("Passwords need at least 6 characters.");
  });
  it("Supabase's invalid-credentials refusal is said in our words, any other as it came", () => {
    expect(A.signInErrorText("Invalid login credentials")).toBe("Wrong username or password.");
    expect(A.signInErrorText("invalid LOGIN")).toBe("Wrong username or password.");
    expect(A.signInErrorText("Request rate limit reached")).toBe("Request rate limit reached");
  });
  it("the start-up message, the local player and the cache key", () => {
    expect(A.PROFILE_LOAD_ERROR).toBe("Couldn't load your account. Check your connection and try again.");
    expect(A.LOCAL_PROFILE).toEqual({ id: "local", username: "local", role: "admin" });
    expect(A.profileCacheKey("u1")).toBe("wh-profile:u1");
  });
});

// The account rules with no state: usernames, passwords, the placeholder email, the messages, the local player.
// Docs: docs/modules/accounts/sign-in.md.

// Accounts are username + password; Supabase Auth needs an email, so each
// username maps to a placeholder address on the reserved .test domain.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const emailFor = (username) => `${String(username).trim().toLowerCase()}@wordhunter.test`;

export const cleanUsername = (username) => String(username || "").trim().toLowerCase();
export const usernameProblem = (name) => (USERNAME_RE.test(name) ? null : "Usernames are 3–20 letters, numbers or _.");
export const passwordProblem = (password) => (String(password || "").length < 6 ? "Passwords need at least 6 characters." : null);
// Supabase's "Invalid login credentials" in our words; any other refusal as it came.
export const signInErrorText = (message) => (/invalid login/i.test(message) ? "Wrong username or password." : message);

export const PROFILE_LOAD_ERROR = "Couldn't load your account. Check your connection and try again.";
export const LOCAL_PROFILE = { id: "local", username: "local", role: "admin" };
export const profileCacheKey = (id) => `wh-profile:${id}`;

// Maintenance (Admin -> Settings): players wait, the admin plays on.
export const maintenanceBlocks = (app, isAdmin) => app.maintenance && !isAdmin;
export const maintenanceText = (app) => app.maintenanceMessage || "We're improving the game. Please come back a little later.";

// Signing out waits for running saves, but not longer than this.
export const SIGN_OUT_WAIT_MS = 5000;
export const signOutFailedText = (e) => `Couldn't log out: ${e.message}`;

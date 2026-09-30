import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Without Supabase settings the app runs in local mode: one local admin,
// everything kept in this browser. Used for development and tests.
export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true }, realtime: { params: { eventsPerSecond: 20 } } })
  : null;

export const isLocalMode = !supabase;

// Accounts are username + password; Supabase Auth needs an email, so each
// username maps to a placeholder address on the reserved .test domain.
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const emailFor = (username) => `${String(username).trim().toLowerCase()}@wordhunter.test`;

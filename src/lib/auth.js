// Access token for calls to our own /api functions (lib/ai.js, lib/images.js). The sign-in state itself is in
// features/auth. Docs: docs/modules/accounts/sign-in.md.
import { isLocalMode, supabase } from "./supabase";

export async function accessToken() {
  if (isLocalMode) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

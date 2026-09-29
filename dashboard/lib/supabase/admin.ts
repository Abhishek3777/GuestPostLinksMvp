import { createClient } from "@supabase/supabase-js";

// Service-role client for admin-only auth operations (inviting users). Never
// import this into a Client Component — the key bypasses RLS and normal auth
// checks entirely, and must never reach the browser bundle.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — required to invite team members.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

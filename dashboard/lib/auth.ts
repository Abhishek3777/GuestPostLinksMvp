import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { profiles } from "./schema";
import { createClient } from "./supabase/server";

export type Role = "admin" | "member";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
}

// Every account is created through the invite flow, which writes the auth
// user and its profiles row in the same step — so a signed-in user with no
// profile shouldn't normally happen. Falls back to "member" rather than
// crashing if it ever does (a locked-out admin is worse than an
// over-cautious member).
//
// Wrapped in React's cache() — every page/layout/API route on a given
// request calls this, and without caching each call was a separate network
// round trip to Supabase's auth server (plus a DB query), 2-3x per request.
async function getCurrentUserUncached(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id));
  return {
    id: user.id,
    email: user.email ?? profile?.email ?? "",
    role: profile?.role ?? "member",
  };
}

export const getCurrentUser = cache(getCurrentUserUncached);

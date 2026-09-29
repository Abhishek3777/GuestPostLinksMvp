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
export async function getCurrentUser(): Promise<CurrentUser | null> {
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

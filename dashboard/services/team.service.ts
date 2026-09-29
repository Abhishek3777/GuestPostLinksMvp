import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/auth";

export async function listTeam() {
  return db.select().from(profiles).orderBy(desc(profiles.createdAt));
}

// Sends Supabase's own invite email (a signup link) and records the role
// they're invited with. The auth user and the profile are two different
// systems (two different Supabase projects, see dashboard/lib/db.ts) — if the
// profile insert fails after the invite email already went out, the person
// can still set their password but has no role until this is retried.
export async function inviteTeamMember(
  email: string,
  role: Role,
  // Where the invite email's link sends them — this app's own /set-password,
  // not Supabase's default (which would land on whatever Site URL the shared
  // auth project happens to be configured with — likely a different app).
  origin: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, email));
  if (existing.length) return { ok: false, error: "Already invited" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/set-password`,
  });
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Invite failed" };
  }

  await db.insert(profiles).values({ id: data.user.id, email, role });
  return { ok: true, id: data.user.id };
}

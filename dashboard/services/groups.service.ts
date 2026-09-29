import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, profiles } from "@/lib/schema";

export async function listGroups() {
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      dedupDays: groups.dedupDays,
      createdAt: groups.createdAt,
      memberCount: sql<number>`count(${profiles.id})::int`,
    })
    .from(groups)
    .leftJoin(profiles, eq(profiles.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(desc(groups.createdAt));
  return rows;
}

export async function createGroup(name: string, dedupDays?: number) {
  const [row] = await db.insert(groups).values({ name, ...(dedupDays ? { dedupDays } : {}) }).returning({ id: groups.id });
  return row.id;
}

// Members in it fall back to no group (ON DELETE SET NULL) — they keep their
// existing campaigns and prospects, they just stop deduping against anyone
// until placed in a group again.
export async function deleteGroup(id: string) {
  await db.delete(groups).where(eq(groups.id, id));
}

// How long a lead one member of this group claims stays off-limits to the
// rest of it — see findClaimedByGroupmates in src/db/filterResults.ts.
export async function setGroupDedupDays(id: string, dedupDays: number) {
  await db.update(groups).set({ dedupDays }).where(eq(groups.id, id));
}

// null clears a member's group.
export async function setMemberGroup(profileId: string, groupId: string | null) {
  await db.update(profiles).set({ groupId }).where(eq(profiles.id, profileId));
}

export async function listTeamWithGroups() {
  return db
    .select({
      id: profiles.id,
      email: profiles.email,
      role: profiles.role,
      createdAt: profiles.createdAt,
      groupId: profiles.groupId,
      groupName: groups.name,
    })
    .from(profiles)
    .leftJoin(groups, eq(groups.id, profiles.groupId))
    .orderBy(desc(profiles.createdAt));
}

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/schema";

// app_settings is a single row (id always 1). Falls back to 90 if the row is
// somehow missing, matching the column's own DB default.
const DEFAULT_DEDUP_DAYS = 90;

export async function getDedupDays(): Promise<number> {
  const [row] = await db.select({ dedupDays: appSettings.dedupDays }).from(appSettings).where(eq(appSettings.id, 1));
  return row?.dedupDays ?? DEFAULT_DEDUP_DAYS;
}

export async function setDedupDays(dedupDays: number) {
  await db
    .insert(appSettings)
    .values({ id: 1, dedupDays })
    .onConflictDoUpdate({ target: appSettings.id, set: { dedupDays } });
}

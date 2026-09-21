import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { campaigns } from "../db/schema.js";

// The Pause button only sets a flag on the campaign; the worker looks at it between
// units of work. Checking the database before every single site would be wasteful
// (a 300-site campaign is 300 lookups for one bit), so a "no" answer is reused for
// a couple of seconds. A "yes" is sticky: once paused, always stop for this run.
const CACHE_MS = 2000;

export function makePauseCheck(campaignId: string): () => Promise<boolean> {
  let paused = false;
  let checkedAt = 0;
  return async () => {
    if (paused) return true;
    if (Date.now() - checkedAt < CACHE_MS) return false;
    const [row] = await db.select({ paused: campaigns.paused }).from(campaigns).where(eq(campaigns.id, campaignId));
    checkedAt = Date.now();
    paused = Boolean(row?.paused);
    return paused;
  };
}

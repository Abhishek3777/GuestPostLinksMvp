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
    // A transient DB hiccup here must never take down the whole campaign —
    // this used to be an unguarded query called outside every domain's own
    // try/catch, so one failed pause-check (confirmed live, under higher
    // concurrency) threw past everything and flipped the entire campaign to
    // "failed", even though every individual domain was fine. Treat a failed
    // check the same as "not paused right now" and just try again next time.
    try {
      const [row] = await db.select({ paused: campaigns.paused }).from(campaigns).where(eq(campaigns.id, campaignId));
      paused = Boolean(row?.paused);
    } catch (err) {
      console.error(`[pauseCheck] could not check campaign ${campaignId}, assuming not paused:`, err);
    } finally {
      // Set even on failure, so a struggling DB gets the normal cache
      // interval before we ask again instead of retrying immediately.
      checkedAt = Date.now();
    }
    return paused;
  };
}

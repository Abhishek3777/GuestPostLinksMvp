import { db } from "./db/client.js";
import { rescueAttempts } from "./db/schema.js";

export type RescueStage = "crawl" | "contact";

// A rescue only counts as recovered when the browser reached a real answer —
// a timeout/error is not a win, and neither is "still blocked".
const RECOVERED_STATUSES = new Set(["success", "has_email", "form_only", "no_contact_found", "no_posts_found"]);

// Bookkeeping only: a failed write is logged and swallowed, never allowed to
// fail the crawl or lookup it describes. The browser is the only rescue tier
// left, so every row is tier "direct_browser" (the column stays for old rows).
export function recordRescueAttempt(row: {
  campaignId: string;
  domain: string;
  stage: RescueStage;
  resultStatus: string;
  bytes?: number;
}): void {
  db.insert(rescueAttempts)
    .values({
      campaignId: row.campaignId,
      domain: row.domain,
      stage: row.stage,
      tier: "direct_browser",
      recovered: RECOVERED_STATUSES.has(row.resultStatus),
      resultStatus: row.resultStatus,
      bytes: Math.round(row.bytes ?? 0),
    })
    .catch((err) => console.error(`[rescue-stats] failed to record rescue for ${row.domain}:`, err));
}

// Sums bytesTransferred across every page one tier loads for one domain, so a
// crawl of many posts is attributed as a single tier attempt.
export function countBytes<R extends { bytesTransferred: number }>(
  fetch: (url: string) => Promise<R>,
): { fetch: (url: string) => Promise<R>; bytes: () => number } {
  let total = 0;
  return {
    fetch: async (url) => {
      const r = await fetch(url);
      total += r.bytesTransferred;
      return r;
    },
    bytes: () => total,
  };
}

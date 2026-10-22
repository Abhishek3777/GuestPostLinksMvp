import { db } from "./db/client.js";
import { rescueAttempts } from "./db/schema.js";

export type RescueTier = "direct_browser" | "proxy_browser" | "capsolver" | "proxy_skipped_budget";
export type RescueStage = "crawl" | "contact";

// Bookkeeping only: a failed write is logged and swallowed, never allowed to
// fail the crawl or lookup it describes (same rule as addProxyBytesUsed).
export function recordRescueAttempt(row: {
  campaignId: string;
  domain: string;
  stage: RescueStage;
  tier: RescueTier;
  resultStatus: string;
  bytes?: number;
}): void {
  db.insert(rescueAttempts)
    .values({
      campaignId: row.campaignId,
      domain: row.domain,
      stage: row.stage,
      tier: row.tier,
      recovered: row.tier !== "proxy_skipped_budget" && row.resultStatus !== "blocked",
      resultStatus: row.resultStatus,
      bytes: Math.round(row.bytes ?? 0),
    })
    .catch((err) => console.error(`[rescue-stats] failed to record ${row.tier} for ${row.domain}:`, err));
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

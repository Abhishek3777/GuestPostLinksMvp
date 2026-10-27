import pLimit from "p-limit";
import { createBrowserFetcher, type BrowserFetcher } from "./contact/browserFetcher.js";

// Shared across the whole worker process, not one per domain: a browser is
// heavy to start, so it's launched once (lazily, on first block) and reused
// for every domain that needs it, same idea as the local rescue scripts but
// long-lived instead of one-shot.
//
// browserLimit caps concurrent Chromium PAGES, independent of the main crawl's
// CRAWL_CONCURRENCY — most domains never reach this at all, only ones the
// plain HTTP client already found blocked, but two real browser tabs is
// already a meaningful chunk of the worker's memory budget.
//
// Default 2. Tunable via BROWSER_CONCURRENCY without a deploy: a lookup waiting
// its turn for a browser page still holds one of CONTACT_CONCURRENCY's slots,
// so when a lot of domains are blocked this limit, not the slot count, is what
// sets the campaign's speed. Each extra page costs roughly 200-300MB of RAM.
export const browserLimit = pLimit(Math.max(1, Number(process.env.BROWSER_CONCURRENCY) || 2));

let browserPromise: Promise<BrowserFetcher> | null = null;

// A plain browser, no proxy and no captcha solver. Confirmed live, 2026-10-14:
// of a real sample of 10 domains the plain HTTP client had found blocked, 2 of
// 10 (20%) succeed with just a real browser. This is the only escalation tier —
// the paid proxy and CapSolver tiers were removed 2026-10-27 after the audit
// found no measurable benefit (docs: memory proxy-captcha-audit-2026-10).
export function getBrowserFetcher(): Promise<BrowserFetcher> {
  browserPromise ??= createBrowserFetcher();
  return browserPromise;
}

// Only ever actually launched if at least one domain got blocked this
// process's lifetime — most deploys/restarts, this is a no-op.
export async function closeRescueFetchers(): Promise<void> {
  const browser = await browserPromise?.catch(() => null);
  await browser?.close().catch(() => undefined);
}

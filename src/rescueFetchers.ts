import pLimit from "p-limit";
import { createBrowserFetcher, type BrowserFetcher } from "./contact/browserFetcher.js";
import { createCapsolverFetcher, type CapsolverFetcher } from "./contact/capsolverFetcher.js";
import { addProxyBytesUsed } from "./db/writeResults.js";
import type { Fetcher, FetchResult } from "./httpClient.js";

// Shared across the whole worker process, not one per domain: a browser is
// heavy to start, so it's launched once (lazily, on first block) and reused
// for every domain that needs it, same idea as the local rescue scripts but
// long-lived instead of one-shot. Uses RESCUE_PROXY_URL, not PROXY_URL — see
// util.ts's playwrightProxy for why that's a separate variable on purpose.
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
let directBrowserPromise: Promise<BrowserFetcher> | null = null;
let capsolverPromise: Promise<CapsolverFetcher> | null = null;

export function getBrowserFetcher(): Promise<BrowserFetcher> {
  browserPromise ??= createBrowserFetcher("RESCUE_PROXY_URL");
  return browserPromise;
}

// A SECOND, separate browser instance with no proxy at all — "NO_PROXY_SENTINEL"
// is deliberately a name that's never set as a real env var, so
// playwrightProxy() always resolves it to "no proxy configured" (see util.ts).
// Confirmed live, 2026-10-14: of a real sample of 10 domains the plain HTTP
// client had found blocked, 2 of 10 (20%) turned out to succeed with just a
// plain browser — no proxy needed for them at all. Tried BEFORE the paid
// proxy escalation below (see withBlockedEscalation in runCampaign.ts and
// lookupWithRetry in contactStage.ts), so that 20% (at least) stops costing
// proxy bandwidth for no reason.
export function getDirectBrowserFetcher(): Promise<BrowserFetcher> {
  directBrowserPromise ??= createBrowserFetcher("NO_PROXY_SENTINEL");
  return directBrowserPromise;
}

// null when CAPSOLVER_API_KEY isn't set — CapSolver is the last resort after
// the plain browser also failed, and is entirely optional.
export function getCapsolverFetcher(): Promise<CapsolverFetcher> | null {
  if (!process.env.CAPSOLVER_API_KEY) return null;
  capsolverPromise ??= createCapsolverFetcher(process.env.CAPSOLVER_API_KEY, "RESCUE_PROXY_URL");
  return capsolverPromise;
}

// Wraps the paid-proxy browser's fetch so every individual page it loads for
// THIS campaign gets added to campaigns.proxy_bytes_used as it happens — not
// batched, not estimated, so isOverProxyBudget (writeResults.ts) can always
// answer in real time. Deliberately only ever applied to getBrowserFetcher()'s
// fetch, at the call site, in withBlockedEscalation (runCampaign.ts) and
// lookupWithRetry (contactStage.ts) — never to getDirectBrowserFetcher's
// (that tier is free, nothing to track) and never by changing
// browserFetcher.ts/pipeline.ts themselves. A failed write is logged and
// swallowed, never allowed to fail the actual crawl/lookup over a budget
// bookkeeping hiccup.
export function withProxyBudgetTracking(
  campaignId: string,
  browser: { fetch: (url: string) => Promise<FetchResult & { bytesTransferred: number }> },
  // Also hands the same per-page byte count to the caller, so the rescue-stats
  // row for this domain carries the bandwidth THIS domain cost.
  onBytes?: (bytes: number) => void,
): Fetcher {
  return async (url: string) => {
    const result = await browser.fetch(url);
    onBytes?.(result.bytesTransferred);
    addProxyBytesUsed(campaignId, result.bytesTransferred).catch((err) =>
      console.error(`[proxy-budget] failed to record ${result.bytesTransferred} byte(s) for campaign ${campaignId}:`, err)
    );
    return result;
  };
}

// Only ever actually launched if at least one domain got blocked this
// process's lifetime — most deploys/restarts, this is a no-op.
export async function closeRescueFetchers(): Promise<void> {
  const browser = await browserPromise?.catch(() => null);
  await browser?.close().catch(() => undefined);
  const directBrowser = await directBrowserPromise?.catch(() => null);
  await directBrowser?.close().catch(() => undefined);
  const capsolver = await capsolverPromise?.catch(() => null);
  await capsolver?.close().catch(() => undefined);
}

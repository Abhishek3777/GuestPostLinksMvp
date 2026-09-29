import pLimit from "p-limit";
import { createBrowserFetcher, type BrowserFetcher } from "./contact/browserFetcher.js";
import { createCapsolverFetcher, type CapsolverFetcher } from "./contact/capsolverFetcher.js";

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
export const browserLimit = pLimit(2);

let browserPromise: Promise<BrowserFetcher> | null = null;
let capsolverPromise: Promise<CapsolverFetcher> | null = null;

export function getBrowserFetcher(): Promise<BrowserFetcher> {
  browserPromise ??= createBrowserFetcher("RESCUE_PROXY_URL");
  return browserPromise;
}

// null when CAPSOLVER_API_KEY isn't set — CapSolver is the last resort after
// the plain browser also failed, and is entirely optional.
export function getCapsolverFetcher(): Promise<CapsolverFetcher> | null {
  if (!process.env.CAPSOLVER_API_KEY) return null;
  capsolverPromise ??= createCapsolverFetcher(process.env.CAPSOLVER_API_KEY, "RESCUE_PROXY_URL");
  return capsolverPromise;
}

// Only ever actually launched if at least one domain got blocked this
// process's lifetime — most deploys/restarts, this is a no-op.
export async function closeRescueFetchers(): Promise<void> {
  const browser = await browserPromise?.catch(() => null);
  await browser?.close().catch(() => undefined);
  const capsolver = await capsolverPromise?.catch(() => null);
  await capsolver?.close().catch(() => undefined);
}

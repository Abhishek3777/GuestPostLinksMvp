import pLimit from "p-limit";
import { eq, and } from "drizzle-orm";
import { db } from "./db/client.js";
import { campaigns, domainCrawlStatus } from "./db/schema.js";
import { saveCrawlResult } from "./db/writeResults.js";
import { crawlDomain } from "./pipeline.js";
import { createBrowserFetcher } from "./contact/browserFetcher.js";
import { withTimeout } from "./util.js";

// One shared browser, many concurrent contexts (same pattern the production
// worker uses) — sequential (concurrency 1) meant ~1936 domains at this
// stealth browser's per-page speed was heading for multiple DAYS, not hours.
// Override with RESCUE_CONCURRENCY if 5 turns out too hot/cold for a given
// machine.
const RESCUE_CONCURRENCY = Math.max(1, Number(process.env.RESCUE_CONCURRENCY) || 5);

// This script never had runCampaign.ts's PER_DOMAIN_TIMEOUT_MS + real
// AbortController cancellation — confirmed live: one domain's Chromium
// context wedged with no error and no timeout ever caught it, silently
// occupying one of the RESCUE_CONCURRENCY slots forever (the other slots
// kept working, but overall throughput quietly dropped and would eventually
// have stalled completely as more slots wedged the same way). Longer than
// production's 6 minutes on purpose — this is explicitly for chasing down
// big/stubborn sites without that tighter constraint — but still bounded.
const RESCUE_TIMEOUT_MS = Math.max(60_000, Number(process.env.RESCUE_TIMEOUT_MS) || 10 * 60_000);

// Post-campaign rescue pass for Stage 1 (discovery/crawl), not contact lookup
// (see rescue-blocked.ts for that). Re-runs whatever a campaign's normal
// worker run (plain HTTP, no browser) marked "blocked" — from THIS machine,
// through a real Chromium. Writes straight back into the
// campaign's domain_crawl_status via the same saveCrawlResult() the worker
// uses, so a recovered domain just shows up as "success" on the dashboard.
//
//   npx tsx src/rescue-domains.ts <campaignId>              (all blocked domains)
//   npx tsx src/rescue-domains.ts <campaignId> a.com b.com  (just these)

const [campaignId, ...explicitDomains] = process.argv.slice(2);
if (!campaignId) {
  console.error("Usage: npx tsx src/rescue-domains.ts <campaignId> [domain...]");
  process.exit(1);
}

const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
if (!campaign) {
  console.error(`Campaign ${campaignId} not found`);
  process.exit(1);
}

const domains = explicitDomains.length
  ? explicitDomains
  : (
      await db
        .select({ domain: domainCrawlStatus.domain })
        .from(domainCrawlStatus)
        .where(and(eq(domainCrawlStatus.campaignId, campaignId), eq(domainCrawlStatus.status, "blocked")))
    ).map((r) => r.domain);

if (domains.length === 0) {
  console.log("No blocked domains found for this campaign.");
  process.exit(0);
}

console.log(`Rescuing ${domains.length} blocked domain(s) from "${campaign.name}":\n  ${domains.join("\n  ")}\n`);

// A live reference the fetcher closure below reads fresh on every call, not
// a one-time-captured value — needed because the WHOLE shared Chromium
// process can die (confirmed live, 2026-11-09: "Target crashed" after
// running for hours), not just one page/context. Once that happens, every
// subsequent browser.fetch() call off the ORIGINAL object fails forever —
// this run silently produced zero further output for 20+ hours because
// nothing ever relaunched it. ensureBrowserAlive below detects that
// specific failure mode and swaps in a fresh browser, same crash-isolation
// principle as the per-domain try/catch, one level up.
let browserFetcher = await createBrowserFetcher();
let relaunching: Promise<void> | null = null;
const BROWSER_DEAD_SIGNS = /Target crashed|Target closed|Browser has been closed|Connection closed/i;

async function ensureBrowserAlive(err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  if (!BROWSER_DEAD_SIGNS.test(message)) return;
  if (!relaunching) {
    relaunching = (async () => {
      console.log("  [!] shared browser appears to have crashed — relaunching...");
      try {
        await browserFetcher.close();
      } catch {
        // already dead, nothing to clean up
      }
      browserFetcher = await createBrowserFetcher();
      console.log("  [!] browser relaunched, resuming");
      relaunching = null;
    })();
  }
  await relaunching;
}

const limit = pLimit(RESCUE_CONCURRENCY);

let recovered = 0;
let crashed = 0;
let done = 0;
await Promise.all(
  domains.map((domain) =>
    limit(async () => {
      // One domain's crash must never sink the whole batch (same reasoning
      // as contactStage.ts) — without this, an uncaught throw (e.g. a
      // pathological sitemap tripping fast-xml-parser's entity-expansion
      // guard, confirmed live) rejects the whole Promise.all and kills every
      // other in-flight and not-yet-started domain with it.
      try {
        const crawlOpts = { targetPostCount: campaign.targetPostCount, days: campaign.daysWindow ?? undefined };
        const controller = new AbortController();
        const result = await withTimeout(
          crawlDomain(domain, {
            ...crawlOpts,
            fetcher: (url) => browserFetcher.fetch(url),
            deadline: Date.now() + RESCUE_TIMEOUT_MS - 30_000,
            signal: controller.signal,
          }),
          RESCUE_TIMEOUT_MS,
          domain,
          controller
        );

        await saveCrawlResult(campaignId, result);
        const ok = result.discoveryStatus === "success";
        if (ok) recovered++;
        done++;
        console.log(
          `  [${done}/${domains.length}] ${domain}: ${ok ? "RECOVERED" : result.discoveryStatus} — ${result.reason ?? `${result.postsProcessed} post(s)`}`
        );
      } catch (err) {
        crashed++;
        done++;
        console.log(
          `  [${done}/${domains.length}] ${domain}: CRASHED — ${err instanceof Error ? err.message : String(err)}`
        );
        await ensureBrowserAlive(err);
      }
    })
  )
);

console.log(`\nRecovered ${recovered} of ${domains.length} (${crashed} crashed).`);
await browserFetcher.close();
process.exit(0);

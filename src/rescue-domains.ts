import { eq, and } from "drizzle-orm";
import { db } from "./db/client.js";
import { campaigns, domainCrawlStatus } from "./db/schema.js";
import { getProcessedPostUrls, saveCrawlResult } from "./db/writeResults.js";
import { crawlDomain } from "./pipeline.js";
import { createBrowserFetcher } from "./contact/browserFetcher.js";
import { createCapsolverFetcher } from "./contact/capsolverFetcher.js";

// Post-campaign rescue pass for Stage 1 (discovery/crawl), not contact lookup
// (see rescue-blocked.ts for that). Re-runs whatever a campaign's normal
// worker run (plain HTTP, no browser) marked "blocked" — from THIS machine,
// through a real Chromium, escalating to CapSolver only if the plain browser
// still can't get past a Turnstile widget. Writes straight back into the
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

const browser = await createBrowserFetcher();
let capsolver: Awaited<ReturnType<typeof createCapsolverFetcher>> | null = null;

let recovered = 0;
for (const domain of domains) {
  const skipPostUrls = campaign.incremental ? await getProcessedPostUrls(domain) : undefined;
  const crawlOpts = { targetPostCount: campaign.targetPostCount, days: campaign.daysWindow ?? undefined, skipPostUrls };

  let result = await crawlDomain(domain, { ...crawlOpts, fetcher: browser.fetch });

  if (result.discoveryStatus === "blocked" && process.env.CAPSOLVER_API_KEY) {
    console.log(`  ${domain}: still blocked after plain browser — trying CapSolver...`);
    capsolver ??= await createCapsolverFetcher(process.env.CAPSOLVER_API_KEY);
    result = await crawlDomain(domain, { ...crawlOpts, fetcher: capsolver.fetch });
  }

  await saveCrawlResult(campaignId, result);
  const ok = result.discoveryStatus === "success";
  if (ok) recovered++;
  console.log(`  ${domain}: ${ok ? "RECOVERED" : result.discoveryStatus} — ${result.reason ?? `${result.postsProcessed} post(s)`}`);
}

console.log(`\nRecovered ${recovered} of ${domains.length}.`);
await browser.close();
await capsolver?.close();
process.exit(0);

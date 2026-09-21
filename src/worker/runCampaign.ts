import pLimit from "p-limit";
import { crawlDomain } from "../pipeline.js";
import { runFilterStage, seedDirectProspects } from "../filter/index.js";
import { runContactStage } from "./contactStage.js";
import {
  getCampaign,
  getCampaignDomains,
  getCheckedDomains,
  getProcessedPostUrls,
  saveCrawlResult,
  updateCampaignStatus,
} from "../db/writeResults.js";

// How many DIFFERENT domains are crawled at once (default 5, the spec's 5-10). The
// per-host rate limit in httpClient.ts keeps each individual site at one request
// per gap no matter what this is set to, so raising it is the safe way to go faster.
function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

const CONCURRENCY = Math.max(1, Number(process.env.CRAWL_CONCURRENCY) || 5);

export async function runCampaignWorker(campaignId: string): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const domains = await getCampaignDomains(campaignId);
  await updateCampaignStatus(campaignId, "running", { startedAt: new Date() });

  try {
    if (campaign.mode === "direct") {
      // "Direct" mode: the uploaded domains ARE the targets. Skip crawling
      // and link-extraction entirely — go straight to Stage 2 (DNC/exclusion
      // check still applies unconditionally) then Stage 3 automatically,
      // since the whole point of this mode is "I already know who to
      // contact, just get me their contact info."
      const filterResult = await seedDirectProspects(campaignId, domains);
      console.log(`Direct mode filter: ${filterResult.kept} kept, ${filterResult.excluded} excluded`, filterResult.byReason);
      await runContactStage(campaignId);
    } else {
      // "Discovery" mode: the normal 3-stage flow. Stage 3 is a separate,
      // manually-triggered step from the dashboard — not run here — so you
      // can see the kept-prospect count before spending scrape effort on it.
      const alreadyChecked = await getCheckedDomains(campaignId);
      const remaining = domains.filter((d) => !alreadyChecked.has(d));
      if (alreadyChecked.size > 0) {
        console.log(`Resuming: ${alreadyChecked.size} domains already checked, ${remaining.length} remaining`);
      }

      const limit = pLimit(CONCURRENCY);
      await Promise.all(
        remaining.map((domain) =>
          limit(async () => {
            // One bad domain must never sink the whole campaign: whatever goes
            // wrong here is recorded as THAT domain's result and the rest carry on.
            try {
              const result = await crawlDomain(domain, {
                targetPostCount: campaign.targetPostCount,
                days: campaign.daysWindow ?? undefined,
                skipPostUrls: campaign.incremental ? await getProcessedPostUrls(domain) : undefined,
              });
              await saveCrawlResult(campaignId, result);
            } catch (err) {
              console.error(`[crawl] ${domain} failed unexpectedly:`, err);
              try {
                await saveCrawlResult(campaignId, {
                  domain,
                  discoveryStatus: "error",
                  reason: `unexpected error: ${errorMessage(err)}`,
                  rows: [],
                  postsProcessed: 0,
                  postsAttempted: 0,
                  skipped: [],
                  processedPosts: [],
                });
              } catch (saveErr) {
                // Could not even record it (database trouble). Leave the domain
                // unchecked: it is picked up again if the campaign is resumed.
                console.error(`[crawl] could not record the failure for ${domain}:`, saveErr);
              }
            }
          })
        )
      );

      const filterResult = await runFilterStage(campaignId, { incremental: campaign.incremental });
      console.log(`Filter stage: ${filterResult.kept} kept, ${filterResult.excluded} excluded`, filterResult.byReason);

      // One run, domains -> contacts: continue straight into Stage 3 when the
      // campaign asked for it (otherwise stop and wait for the manual button).
      if (campaign.autoContact) {
        console.log("Auto contact lookup enabled — running Stage 3 on kept prospects");
        await runContactStage(campaignId);
      }
    }

    await updateCampaignStatus(campaignId, "completed", { completedAt: new Date() });
  } catch (err) {
    await updateCampaignStatus(campaignId, "failed", { completedAt: new Date() });
    throw err;
  }
}

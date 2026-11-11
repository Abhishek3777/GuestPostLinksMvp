import pLimit from "p-limit";
import { crawlDomain, type CrawlDomainOptions } from "../pipeline.js";
import { runFilterStage, seedDirectProspects } from "../filter/index.js";
import { runContactStage } from "./contactStage.js";
import { makePauseCheck } from "./pauseCheck.js";
import { updateContactStageStatus } from "../db/contactResults.js";
import { browserLimit, getBrowserFetcher } from "../rescueFetchers.js";
import { countBytes, recordRescueAttempt } from "../rescueStats.js";
import { withTimeout } from "../util.js";

// Hard ceiling on one domain's total crawl time, regardless of how many
// candidate posts it has to try — see withTimeout in util.ts for why this
// exists at all.
//
// 3 minutes turned out to be too tight: measured live, a domain that
// legitimately works through its full 50-try budget (lots of real content,
// just all older than the requested window) needs ~175-210s even running
// ALONE with no contention — and at real concurrency, competing with dozens
// of other domains for the same CPU/memory/network, that same domain takes
// longer still. The 3-minute cap was cutting off a large share of
// legitimately-still-working domains before they finished (confirmed: the
// error rate went UP after lowering this, not down), not just the truly
// stuck ones it was meant for. 6 minutes gives real margin above the
// measured ~200s baseline instead of guessing; CRAWL_CONCURRENCY was also
// lowered (65 -> 35) alongside this, since contention from running too many
// domains at once was the deeper cause, not just the cap being short.
//
// Raised 6 -> 15 minutes, 2026-11-10: confirmed live against a real 4,665-
// domain campaign that genuinely large/active sites (hundreds of real,
// in-window posts) were hitting this ceiling at only ~100-120 processed,
// every one logged "likely more available ... not a failure" — real
// recoverable data being left on the table purely because of wall-clock,
// not because the site was unreachable or slow. Deliberately NOT jumped
// higher than this in one step, same reasoning as the 3->6 change above:
// a longer per-domain ceiling means each of CRAWL_CONCURRENCY's slots can
// stay occupied longer on average, which raises real memory/CPU pressure
// even though the slot COUNT hasn't changed — and this worker just came out
// of a real heap-limit crash-loop this same week. Watch real memory/CPU on
// the next campaign this runs against before considering raising it further.
//
// Raised 15 -> 30 minutes, 2026-11-11: the 15-minute step held up clean —
// checked live against "Shilpi 5 Nov 25k" (13,544 domains so far): worker
// logs show zero heap/OOM/crash signals, and the blocked rate (974/13,544,
// ~7.2%) is unchanged from the historical baseline, confirming this ceiling
// only affects how much of an ALREADY-reachable site gets read, never
// whether a site blocks us — so it can't be inflating the blocked count.
// Real upside confirmed too: 966 of 9,972 successful domains (~10%) were
// still hitting the 15-minute wall, some with thousands of untapped real
// candidates (e.g. one domain: 290 processed of 4,001 real candidates).
// Same incremental discipline as the last step — doubling again, not
// jumping further, so the next check has a clean baseline to compare
// against before going beyond 30.
const PER_DOMAIN_TIMEOUT_MS = 30 * 60_000;
import {
  getCampaign,
  getCampaignDomains,
  getCheckedDomains,
  getDomainsByStatus,
  recordCampaignCrash,
  saveCrawlResult,
  updateCampaignStatus,
} from "../db/writeResults.js";
import { resetFailedContacts } from "../db/contactResults.js";

// A domain the plain HTTP client found "blocked" gets one more try from here,
// through a real browser — same escalation the local rescue-domains.ts script
// does by hand, just automatic now. Most domains never reach this at all.
async function withBlockedEscalation(domain: string, campaignId: string, opts: CrawlDomainOptions) {
  const plain = await crawlDomain(domain, opts);
  if (plain.discoveryStatus !== "blocked") return plain;

  return browserLimit(async () => {
    const browser = await getBrowserFetcher();
    const counted = countBytes(browser.fetch);
    const viaBrowser = await crawlDomain(domain, { ...opts, fetcher: counted.fetch });
    recordRescueAttempt({ campaignId, domain, stage: "crawl", resultStatus: viaBrowser.discoveryStatus, bytes: counted.bytes() });
    return viaBrowser;
  });
}

// How many DIFFERENT domains are crawled at once (default 5, the spec's 5-10). The
// per-host rate limit in httpClient.ts keeps each individual site at one request
// per gap no matter what this is set to, so raising it is the safe way to go faster.
function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

const CONCURRENCY = Math.max(1, Number(process.env.CRAWL_CONCURRENCY) || 5);

// The DB pool (src/db/client.ts) caps out at 10 connections — lowered from 25
// on 2026-10-13 because Supabase's own pooler only hands out 15 real
// connections total, shared with the dashboard (4) and some headroom for
// ad-hoc scripts; the worker alone requesting 25 was starving the dashboard
// whenever a campaign was actively running. CRAWL_CONCURRENCY can still run
// well above 10 (35 in prod), which is fine for crawling — most of each
// domain's time is spent waiting on the target site, not touching the
// database — but if a batch of slow domains all hit PER_DOMAIN_TIMEOUT_MS at
// once, that's a burst of simultaneous saves that needs to stay well under
// the pool size or it fails outright (confirmed: a one-off recovery script
// running the same crawlDomain+save pattern at high concurrency silently
// lost ~22% of its results this way before this same fix was applied
// there). Gating the write specifically, separately from crawl concurrency,
// fixes it without slowing the crawling itself down at all.
const dbWriteLimit = pLimit(8);

// Park a campaign the user paused part-way: back to "queued" (the claim query skips
// it while it is paused) with its contact stage reset, so Resume runs the whole job
// again and it carries on from what is still unfinished — crawl skips domains
// already checked, contact lookup only touches prospects still pending.
async function parkPausedCampaign(campaignId: string): Promise<void> {
  await updateCampaignStatus(campaignId, "queued");
  await updateContactStageStatus(campaignId, "not_started");
  console.log(`[worker] campaign ${campaignId} paused — it will continue from here when resumed`);
}

// One automatic pass, run once right before a campaign is marked "completed":
// retries Stage 1 domains that ended in "error" and Stage 3 contact lookups
// that failed (timeout/dns_error/error). Before this existed, recovering
// those required someone manually re-running this exact sequence by hand
// after every campaign (proven safe and effective doing it for real
// campaigns — this is that same sequence, promoted into the normal
// pipeline so "completed" means the real final numbers).
//
// Plain crawlDomain only, no browser escalation — escalation OOM'd even at
// modest concurrency when tried for this. A domain still blocked by a JS
// challenge after the main run stays unrecovered; that's an accepted gap,
// not a bug.
async function recoverFailures(campaignId: string, campaign: NonNullable<Awaited<ReturnType<typeof getCampaign>>>): Promise<"ok" | "paused"> {
  if (campaign.mode === "discovery") {
    const errorDomains = await getDomainsByStatus(campaignId, "error");
    if (errorDomains.length > 0) {
      console.log(`[recovery] retrying ${errorDomains.length} Stage 1 error domain(s)`);
      const limit = pLimit(CONCURRENCY);
      const shouldPause = makePauseCheck(campaignId);
      let leftForPause = 0;
      await Promise.all(
        errorDomains.map((domain) =>
          limit(async () => {
            if (await shouldPause()) {
              leftForPause++;
              return;
            }
            try {
              const controller = new AbortController();
              const result = await withTimeout(
                crawlDomain(domain, {
                  targetPostCount: campaign.targetPostCount,
                  days: campaign.daysWindow ?? undefined,
                  deadline: Date.now() + PER_DOMAIN_TIMEOUT_MS - 30_000,
                  signal: controller.signal,
                }),
                PER_DOMAIN_TIMEOUT_MS,
                domain,
                controller
              );
              await dbWriteLimit(() => saveCrawlResult(campaignId, result));
            } catch (err) {
              console.error(`[recovery] ${domain} still failing:`, errorMessage(err));
            }
          })
        )
      );
      if (leftForPause > 0) return "paused";

      const filterResult = await runFilterStage(campaignId);
      console.log(`[recovery] filter stage: ${filterResult.kept} kept, ${filterResult.excluded} excluded`, filterResult.byReason);
    }
  }

  if (campaign.mode === "direct" || campaign.autoContact) {
    const resetCount = await resetFailedContacts(campaignId);
    if (resetCount > 0) {
      console.log(`[recovery] retrying ${resetCount} previously-failed contact lookup(s)`);
      if ((await runContactStage(campaignId)) === "paused") return "paused";
    }
  }

  return "ok";
}

export async function runCampaignWorker(campaignId: string): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const domains = await getCampaignDomains(campaignId);

  // Nothing to work on is a FAILED campaign, not a completed one — "completed" with
  // 0 of 0 domains told a user their run had succeeded when it never began.
  if (domains.length === 0) {
    console.error(`[worker] campaign ${campaignId} has no domains — marking it failed`);
    await updateCampaignStatus(campaignId, "failed", { completedAt: new Date() });
    return;
  }

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
      if ((await runContactStage(campaignId)) === "paused") {
        await parkPausedCampaign(campaignId);
        return;
      }
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
      const shouldPause = makePauseCheck(campaignId);
      let leftForPause = 0;
      await Promise.all(
        remaining.map((domain) =>
          limit(async () => {
            // Paused from the dashboard: start nothing new (sites already in flight
            // finish and are saved normally).
            if (await shouldPause()) {
              leftForPause++;
              return;
            }
            // One bad domain must never sink the whole campaign: whatever goes
            // wrong here is recorded as THAT domain's result and the rest carry on.
            try {
              // Real cancellation, not just abandonment — see util.ts's
              // withTimeout and pipeline.ts's CrawlDomainOptions.signal.
              // Without this, a domain still mid-loop through a huge
              // candidate list when PER_DOMAIN_TIMEOUT_MS fires kept running
              // orphaned in the background indefinitely; piling up a couple
              // of those at once is what was actually crashing the worker.
              const controller = new AbortController();
              const result = await withTimeout(
                withBlockedEscalation(domain, campaignId, {
                  targetPostCount: campaign.targetPostCount,
                  days: campaign.daysWindow ?? undefined,
                  // 30s margin before the outer withTimeout below actually fires —
                  // enough for one in-flight request to finish and the loop to
                  // return cleanly, rather than being killed mid-flight. See
                  // CrawlDomainOptions.deadline for why this exists at all: a
                  // domain with a genuinely huge legitimate archive (confirmed
                  // live — a real site, 5,000+ real posts, every one succeeding)
                  // was always getting externally killed and dumped into generic
                  // "error" despite actively succeeding the whole time.
                  deadline: Date.now() + PER_DOMAIN_TIMEOUT_MS - 30_000,
                  signal: controller.signal,
                }),
                PER_DOMAIN_TIMEOUT_MS,
                domain,
                controller
              );
              await dbWriteLimit(() => saveCrawlResult(campaignId, result));
            } catch (err) {
              console.error(`[crawl] ${domain} failed unexpectedly:`, err);
              try {
                await dbWriteLimit(() =>
                  saveCrawlResult(campaignId, {
                    domain,
                    discoveryStatus: "error",
                    reason: `unexpected error: ${errorMessage(err)}`,
                    rows: [],
                    postsProcessed: 0,
                    postsAttempted: 0,
                    skipped: [],
                    processedPosts: [],
                  })
                );
              } catch (saveErr) {
                // Could not even record it (database trouble). Leave the domain
                // unchecked: it is picked up again if the campaign is resumed.
                console.error(`[crawl] could not record the failure for ${domain}:`, saveErr);
              }
            }
          })
        )
      );

      if (leftForPause > 0) {
        await parkPausedCampaign(campaignId);
        return;
      }

      const filterResult = await runFilterStage(campaignId);
      console.log(`Filter stage: ${filterResult.kept} kept, ${filterResult.excluded} excluded`, filterResult.byReason);

      // One run, domains -> contacts: continue straight into Stage 3 when the
      // campaign asked for it (otherwise stop and wait for the manual button).
      if (campaign.autoContact) {
        console.log("Auto contact lookup enabled — running Stage 3 on kept prospects");
        if ((await runContactStage(campaignId)) === "paused") {
          await parkPausedCampaign(campaignId);
          return;
        }
      }
    }

    if ((await recoverFailures(campaignId, campaign)) === "paused") {
      await parkPausedCampaign(campaignId);
      return;
    }

    await updateCampaignStatus(campaignId, "completed", { completedAt: new Date() });
  } catch (err) {
    const outcome = await recordCampaignCrash(campaignId);
    console.error(`[worker] campaign ${campaignId} crashed (${outcome}):`, err);
    throw err;
  }
}

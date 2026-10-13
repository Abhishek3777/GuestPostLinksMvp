import { claimNextCampaign, claimNextContactStage, requeueInterruptedJobs } from "../db/jobs.js";
import { sleep } from "../util.js";
import { runCampaignWorker } from "./runCampaign.js";
import { runContactStage } from "./contactStage.js";
import { resetFailedContacts, updateContactStageStatus } from "../db/contactResults.js";
import { closeRescueFetchers } from "../rescueFetchers.js";

// Long-running worker: polls Supabase for queued campaigns and runs several at
// a time. Run it as its own service (PM2 / systemd), separate from the
// dashboard — restarting the dashboard no longer touches a crawl, and
// restarting this only pauses whatever's in flight: on startup it re-queues
// whatever the previous process was in the middle of and carries on.
//
// MAX_CONCURRENT_CAMPAIGNS jobs run side by side, but all inside THIS ONE
// process, on purpose: the per-host rate limit in httpClient.ts lives in this
// process's memory, so every concurrent job shares and respects the same
// limit. Running multiple separate worker instances instead would each get
// their own private copy of that limit, with no way to coordinate against
// each other — that's a real, different problem (see the group-dedup lock in
// filter/index.ts for the other race this same change had to account for).
//
// Claiming a job is already an atomic `UPDATE ... FOR UPDATE SKIP LOCKED`
// (see db/jobs.ts), so any number of concurrent slots can poll at once
// without ever double-claiming the same campaign.
const MAX_CONCURRENT_CAMPAIGNS = Math.max(1, Number(process.env.MAX_CONCURRENT_CAMPAIGNS) || 3);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;

// A stop signal ends the process straight away. The job in flight stays marked
// "running" in the database, which is exactly what requeueInterruptedJobs()
// looks for on the next start.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received — exiting; any running job is resumed on next start`);
    // Best-effort: closes Chromium if the blocked-domain escalation ever
    // launched it this process's lifetime. Capped wait so a stuck browser
    // can never block the shutdown Railway is waiting for.
    void Promise.race([closeRescueFetchers(), sleep(3000)]).finally(() => process.exit(0));
  });
}

async function runNextJob(slot: number): Promise<boolean> {
  const contactCampaignId = await claimNextContactStage();
  if (contactCampaignId) {
    console.log(`[worker:${slot}] contact stage for campaign ${contactCampaignId}`);
    try {
      let outcome = await runContactStage(contactCampaignId);
      // Same end-of-campaign recovery as the full pipeline (runCampaign.ts) —
      // this is the manual "Run Contact Stage" path, which is its own way a
      // campaign "ends" and deserves the same automatic retry of failed
      // lookups rather than requiring a human to redo it by hand.
      if (outcome !== "paused") {
        const resetCount = await resetFailedContacts(contactCampaignId);
        if (resetCount > 0) {
          console.log(`[worker:${slot}] retrying ${resetCount} previously-failed contact lookup(s) for campaign ${contactCampaignId}`);
          outcome = await runContactStage(contactCampaignId);
        }
      }
      if (outcome === "paused") {
        // Back in the contact queue; the claim query skips it until Resume.
        await updateContactStageStatus(contactCampaignId, "queued");
        console.log(`[worker:${slot}] contact stage for campaign ${contactCampaignId} paused`);
      } else {
        console.log(`[worker:${slot}] contact stage for campaign ${contactCampaignId} finished`);
      }
    } catch (err) {
      // runContactStage already marked it failed
      console.error(`[worker:${slot}] contact stage for campaign ${contactCampaignId} failed:`, err);
    }
    return true;
  }

  const campaignId = await claimNextCampaign();
  if (campaignId) {
    console.log(`[worker:${slot}] campaign ${campaignId}`);
    try {
      await runCampaignWorker(campaignId);
      console.log(`[worker:${slot}] campaign ${campaignId} finished`);
    } catch (err) {
      // runCampaignWorker already marked it failed
      console.error(`[worker:${slot}] campaign ${campaignId} failed:`, err);
    }
    return true;
  }

  return false;
}

// On a fresh deploy the database can be unreachable for a few seconds (pooler
// waking up, network not ready yet). Wait it out here instead of crashing —
// a crash-restart loop would hit the platform's restart limit.
let recovered: Awaited<ReturnType<typeof requeueInterruptedJobs>>;
while (true) {
  try {
    recovered = await requeueInterruptedJobs();
    break;
  } catch (err) {
    console.error("[worker] database not reachable yet, retrying in 5s:", (err as Error).message);
    await sleep(5000);
  }
}
if (recovered.campaigns || recovered.contactStages) {
  console.log(
    `[worker] resuming interrupted work: ${recovered.campaigns} campaign(s), ${recovered.contactStages} contact stage(s)`
  );
}
console.log(`[worker] started, ${MAX_CONCURRENT_CAMPAIGNS} concurrent slot(s), polling every ${POLL_INTERVAL_MS}ms`);

async function workerSlot(slot: number): Promise<never> {
  while (true) {
    try {
      const didWork = await runNextJob(slot);
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      // e.g. the database is briefly unreachable — log it and keep polling
      console.error(`[worker:${slot}] poll error:`, err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

await Promise.all(Array.from({ length: MAX_CONCURRENT_CAMPAIGNS }, (_, i) => workerSlot(i + 1)));

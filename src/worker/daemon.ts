import { claimNextCampaign, claimNextContactStage, requeueInterruptedJobs } from "../db/jobs.js";
import { sleep } from "../util.js";
import { runCampaignWorker } from "./runCampaign.js";
import { runContactStage } from "./contactStage.js";
import { updateContactStageStatus } from "../db/contactResults.js";

// Long-running worker: polls Supabase for queued campaigns and runs them one at
// a time. Run it as its own service (PM2 / systemd), separate from the
// dashboard — restarting the dashboard no longer touches a crawl, and
// restarting this only pauses one: on startup it re-queues whatever the
// previous process was in the middle of and carries on.
//
// One job at a time on purpose: the per-host rate limit in httpClient.ts lives
// in this process's memory, so two campaigns in parallel would not respect it
// against each other.

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;

// A stop signal ends the process straight away. The job in flight stays marked
// "running" in the database, which is exactly what requeueInterruptedJobs()
// looks for on the next start.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received — exiting; any running job is resumed on next start`);
    process.exit(0);
  });
}

async function runNextJob(): Promise<boolean> {
  const contactCampaignId = await claimNextContactStage();
  if (contactCampaignId) {
    console.log(`[worker] contact stage for campaign ${contactCampaignId}`);
    try {
      const outcome = await runContactStage(contactCampaignId);
      if (outcome === "paused") {
        // Back in the contact queue; the claim query skips it until Resume.
        await updateContactStageStatus(contactCampaignId, "queued");
        console.log(`[worker] contact stage for campaign ${contactCampaignId} paused`);
      } else {
        console.log(`[worker] contact stage for campaign ${contactCampaignId} finished`);
      }
    } catch (err) {
      // runContactStage already marked it failed
      console.error(`[worker] contact stage for campaign ${contactCampaignId} failed:`, err);
    }
    return true;
  }

  const campaignId = await claimNextCampaign();
  if (campaignId) {
    console.log(`[worker] campaign ${campaignId}`);
    try {
      await runCampaignWorker(campaignId);
      console.log(`[worker] campaign ${campaignId} finished`);
    } catch (err) {
      // runCampaignWorker already marked it failed
      console.error(`[worker] campaign ${campaignId} failed:`, err);
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
console.log(`[worker] started, polling every ${POLL_INTERVAL_MS}ms`);

while (true) {
  try {
    const didWork = await runNextJob();
    if (!didWork) await sleep(POLL_INTERVAL_MS);
  } catch (err) {
    // e.g. the database is briefly unreachable — log it and keep polling
    console.error("[worker] poll error:", err);
    await sleep(POLL_INTERVAL_MS);
  }
}

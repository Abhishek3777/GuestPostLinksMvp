import pLimit from "p-limit";
import { findContact } from "../contact/findContact.js";
import {
  getKeptPendingProspects,
  saveContactExclusion,
  saveContactResult,
  updateContactStageStatus,
} from "../db/contactResults.js";
import { loadDoNotContactSet } from "../db/filterResults.js";
import { destinationExclusion } from "../contact/destination.js";

// Pure HTTP, lighter per-request than the crawler — no article parsing. Default 8.
const CONCURRENCY = Math.max(1, Number(process.env.CONTACT_CONCURRENCY) || 8);
// Per-host spacing lives in httpClient.ts, so concurrency here only controls
// how many DIFFERENT sites are being worked on at once.

export async function runContactStage(campaignId: string): Promise<void> {
  await updateContactStageStatus(campaignId, "running", { contactStageStartedAt: new Date() });

  try {
    const prospects = await getKeptPendingProspects(campaignId);
    const doNotContact = await loadDoNotContactSet();
    const limit = pLimit(CONCURRENCY);

    await Promise.all(
      prospects.map((prospect) =>
        limit(async () => {
          // One bad site must never sink the whole contact stage: whatever goes
          // wrong is recorded as THAT prospect's result and the rest carry on.
          try {
            const result = await findContact(prospect.rootDomain);

            // Where the site really ends up gets the same exclusion rules the
            // prospect itself passed — a redirect to a big brand or a parked page
            // is not a lead.
            const moved = destinationExclusion(
              prospect.rootDomain,
              [result.finalDomain, result.successorDomain],
              doNotContact
            );
            if (moved) {
              await saveContactExclusion(
                prospect.id,
                moved.reason,
                `redirects to / moved to ${moved.destination} (${moved.reason})`,
                moved.destination
              );
            } else {
              await saveContactResult(prospect.id, result);
            }
          } catch (err) {
            console.error(`[contact] ${prospect.rootDomain} failed unexpectedly:`, err);
            try {
              await saveContactResult(prospect.id, {
                status: "error",
                emailAddress: null,
                contactFormUrl: null,
                finalDomain: null,
                reason: `unexpected error: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
              });
            } catch (saveErr) {
              // Could not even record it (database trouble): it stays "pending"
              // and is picked up if the stage is resumed.
              console.error(`[contact] could not record the failure for ${prospect.rootDomain}:`, saveErr);
            }
          }
        })
      )
    );

    await updateContactStageStatus(campaignId, "completed", { contactStageCompletedAt: new Date() });
  } catch (err) {
    await updateContactStageStatus(campaignId, "failed", { contactStageCompletedAt: new Date() });
    throw err;
  }
}

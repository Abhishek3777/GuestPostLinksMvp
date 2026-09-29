import pLimit from "p-limit";
import { findContact, type ContactResult } from "../contact/findContact.js";
import { sleep } from "../util.js";
import {
  getKeptPendingProspects,
  saveContactExclusion,
  saveContactResult,
  updateContactStageStatus,
} from "../db/contactResults.js";
import { loadDoNotContactSet } from "../db/filterResults.js";
import { destinationExclusion } from "../contact/destination.js";
import { makePauseCheck } from "./pauseCheck.js";
import { browserLimit, getBrowserFetcher, getCapsolverFetcher } from "../rescueFetchers.js";

// Pure HTTP, lighter per-request than the crawler — no article parsing. Default 8.
const CONCURRENCY = Math.max(1, Number(process.env.CONTACT_CONCURRENCY) || 8);
// Per-host spacing lives in httpClient.ts, so concurrency here only controls
// how many DIFFERENT sites are being worked on at once.

// A timeout or a dropped connection is very often momentary (a busy shared host, a
// blip). In the first real retry of failures, 5 of 8 of them succeeded the second time,
// so try once more after a short pause before writing the site off. Blocks are NOT
// retried straight away: hammering a site that just refused us only makes it worse —
// this is the plain-HTTP retry; a real block still only escalates to a browser once,
// below, never repeated.
const RETRY_ONCE = new Set<string>(["timeout", "error"]);
async function lookupWithRetry(domain: string): Promise<ContactResult> {
  const first = await findContact(domain);
  if (RETRY_ONCE.has(first.status)) {
    await sleep(4000);
    const second = await findContact(domain);
    if (second.status !== "blocked") return second;
  } else if (first.status !== "blocked") {
    return first;
  }

  // Blocked (on the first try, or still after the timeout/error retry): one
  // escalation pass through a real browser, then CapSolver if that specific
  // wall is an actual solvable captcha. Same as the local rescue-contacts.ts
  // script, just automatic and one-shot — no repeated hammering of a site
  // that already said no.
  return browserLimit(async () => {
    const browser = await getBrowserFetcher();
    const viaBrowser = await findContact(domain, browser.fetch);
    if (viaBrowser.status !== "blocked") return viaBrowser;

    const capsolver = getCapsolverFetcher();
    if (!capsolver) return viaBrowser;
    return findContact(domain, (await capsolver).fetch);
  });
}

// "paused" = the Pause button was pressed part-way: sites already in flight were
// finished, the rest were left "pending". The CALLER decides how to park the campaign
// (it differs for an inline stage inside a campaign job vs. a separately queued stage).
export async function runContactStage(campaignId: string): Promise<"completed" | "paused"> {
  await updateContactStageStatus(campaignId, "running", { contactStageStartedAt: new Date() });

  try {
    const prospects = await getKeptPendingProspects(campaignId);
    const doNotContact = await loadDoNotContactSet();
    const limit = pLimit(CONCURRENCY);
    const shouldPause = makePauseCheck(campaignId);
    let leftForPause = 0;

    await Promise.all(
      prospects.map((prospect) =>
        limit(async () => {
          if (await shouldPause()) {
            leftForPause++;
            return;
          }
          // One bad site must never sink the whole contact stage: whatever goes
          // wrong is recorded as THAT prospect's result and the rest carry on.
          try {
            const result = await lookupWithRetry(prospect.rootDomain);

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

    if (leftForPause > 0) {
      console.log(`[contact] campaign ${campaignId} paused with ${leftForPause} site(s) still to look up`);
      return "paused";
    }

    await updateContactStageStatus(campaignId, "completed", { contactStageCompletedAt: new Date() });
    return "completed";
  } catch (err) {
    await updateContactStageStatus(campaignId, "failed", { contactStageCompletedAt: new Date() });
    throw err;
  }
}

import pLimit from "p-limit";
import { findContact, type ContactResult } from "../contact/findContact.js";
import { sleep, withTimeout } from "../util.js";
import {
  backfillContactEmails,
  getKeptPendingProspects,
  recordContactStageCrash,
  saveContactExclusion,
  saveContactResult,
  updateContactStageStatus,
} from "../db/contactResults.js";
import { loadDoNotContactSet } from "../db/filterResults.js";
import { exclusionReason } from "../filter/exclusions.js";
import { contentLooksLikeGambling } from "../filter/gambling.js";
import { looksLikeGovOrInstitutional } from "../filter/institutional.js";
import { looksLikeScholarshipDomain, classifyBusinessRelevanceCached } from "../filter/businessRelevance.js";
import { makePauseCheck } from "./pauseCheck.js";
import { browserLimit, getBrowserFetcher, getCapsolverFetcher } from "../rescueFetchers.js";

// The three new checks from docs/prospect-relevance-filter.md, run in this
// order against the homepage Stage 3 just fetched anyway (no extra crawl):
// gambling and institutional are cheap/deterministic so they go first;
// the scholarship keyword is a free pre-filter for the AI step; the AI call
// itself (cached per domain — see domain_relevance_cache) only runs if
// nothing else already decided it. Returns null when nothing fires (keep
// as a normal prospect, no change from today's behavior).
async function checkRelevance(rootDomain: string, homepageHtml: string): Promise<{ reason: string; note: string } | null> {
  if (contentLooksLikeGambling(homepageHtml)) {
    return { reason: "gambling_content", note: "homepage content reads as gambling/casino" };
  }
  if (looksLikeGovOrInstitutional(rootDomain, homepageHtml)) {
    return { reason: "government_or_institutional", note: "looks like a government or financial-institution site" };
  }
  // "not_a_business" exclusion disabled for now (2026-10-13) — too many real,
  // legitimate businesses offering real services were coming back as false
  // positives. Per team decision: merge these back into the main pipeline
  // (contact them like any other kept prospect) until the classifier is
  // tuned properly. Still calling classifyBusinessRelevanceCached below,
  // which still writes to domain_relevance_cache regardless of what we do
  // with its answer — so the data needed to evaluate and re-enable this
  // later keeps accumulating the whole time, nothing lost by waiting.
  if (looksLikeScholarshipDomain(rootDomain)) return null;
  const { decision, reason } = await classifyBusinessRelevanceCached(rootDomain, homepageHtml);
  if (decision === "unsure") return { reason: "needs_review", note: reason };
  return null;
}

// Pure HTTP, lighter per-request than the crawler — no article parsing. Default 8.
const CONCURRENCY = Math.max(1, Number(process.env.CONTACT_CONCURRENCY) || 8);

// Same DB-pool reasoning as runCampaign.ts's dbWriteLimit — CONTACT_CONCURRENCY
// runs at 50 in prod, well above the pool's 10-connection cap (lowered from
// 25 on 2026-10-13, see runCampaign.ts), so a burst of lookups finishing
// together can still overwhelm it even though crawling and contact stages
// now never run at the same time as each other.
const dbWriteLimit = pLimit(8);

// Same hard ceiling idea as runCampaign.ts's PER_DOMAIN_TIMEOUT_MS, shorter
// since a contact lookup is lighter than a full crawl — see withTimeout in
// util.ts for why this exists.
const PER_PROSPECT_TIMEOUT_MS = 5 * 60_000;
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
          // Stage 2 decided "kept" whenever this prospect was first saved — but the
          // do-not-contact list can change afterward (a monitoring re-run finds the
          // same domain again, or it's simply added later while this prospect sits
          // "kept, pending"). Re-check right before we'd actually go find contact
          // details, so a domain added to the list after the fact never gets emailed
          // or has its contact form looked up.
          if (exclusionReason(prospect.rootDomain, doNotContact) === "do_not_contact") {
            await dbWriteLimit(() =>
              saveContactExclusion(
                prospect.id,
                "do_not_contact",
                "on the do-not-contact list (caught before contact lookup)",
                null
              )
            );
            return;
          }
          // One bad site must never sink the whole contact stage: whatever goes
          // wrong is recorded as THAT prospect's result and the rest carry on.
          try {
            const result = await withTimeout(lookupWithRetry(prospect.rootDomain), PER_PROSPECT_TIMEOUT_MS, prospect.rootDomain);

            // Gambling / government-institutional / "is this actually a
            // business" — checked against the homepage we already have in
            // hand, before anything else. See checkRelevance above.
            if (result.homepageHtml !== null) {
              const relevance = await checkRelevance(prospect.rootDomain, result.homepageHtml);
              if (relevance) {
                await dbWriteLimit(() =>
                  saveContactExclusion(prospect.id, relevance.reason, relevance.note, result.finalDomain)
                );
                return;
              }
            }

            // ANY redirect pulls a prospect out of Contacts and into Excluded,
            // uniformly reason "redirected" (2026-10-13, per team decision) —
            // not just ones that happen to also break an exclusion rule, and
            // not split out by what rule it happens to match either. Marketing
            // bulk-opens the ORIGINAL list of input domains after a campaign
            // ends; a domain that quietly points somewhere else by the time
            // they open it needs to be impossible to miss, not buried as a
            // column on an otherwise-normal row.
            const destination = result.finalDomain ?? result.successorDomain;
            if (destination) {
              await dbWriteLimit(() =>
                saveContactExclusion(prospect.id, "redirected", `redirected from ${prospect.rootDomain} to ${destination}`, destination)
              );
            } else {
              await dbWriteLimit(() => saveContactResult(prospect.id, result));
            }
          } catch (err) {
            console.error(`[contact] ${prospect.rootDomain} failed unexpectedly:`, err);
            try {
              await dbWriteLimit(() =>
                saveContactResult(prospect.id, {
                  status: "error",
                  emailAddress: null,
                  contactFormUrl: null,
                  finalDomain: null,
                  homepageHtml: null,
                  reason: `unexpected error: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
                })
              );
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

    const picked = await backfillContactEmails(campaignId);
    console.log(`[contact] campaign ${campaignId} picked a contact email for ${picked} prospect(s)`);

    await updateContactStageStatus(campaignId, "completed", { contactStageCompletedAt: new Date() });
    return "completed";
  } catch (err) {
    const outcome = await recordContactStageCrash(campaignId);
    console.error(`[worker] contact stage for campaign ${campaignId} crashed (${outcome}):`, err);
    throw err;
  }
}

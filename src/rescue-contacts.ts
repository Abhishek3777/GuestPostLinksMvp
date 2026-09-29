import { and, eq, inArray, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "./db/client.js";
import { guestPostProspects } from "./db/schema.js";
import { saveContactExclusion, saveContactResult } from "./db/contactResults.js";
import { loadDoNotContactSet } from "./db/filterResults.js";
import { findContact, type ContactResult } from "./contact/findContact.js";
import { destinationExclusion } from "./contact/destination.js";
import { createBrowserFetcher } from "./contact/browserFetcher.js";
import { createCapsolverFetcher } from "./contact/capsolverFetcher.js";

// Post-campaign rescue pass for Stage 3 (contact lookup) — same idea as
// rescue-domains.ts but for the "Retry blocked & failed" pool. The dashboard's
// button re-queues these for the DEPLOYED worker, which retries with the exact
// same plain HTTP from the exact same datacenter IP — so it recovers nothing
// new. This runs them from THIS machine instead: plain fetch first (a
// different IP alone recovers some blocks), then a real browser, then
// CapSolver only if a Turnstile widget is actually present.
//
//   npx tsx src/rescue-contacts.ts <campaignId>

const RETRYABLE = ["blocked", "timeout", "dns_error", "error"] as const;
const CONCURRENCY = 6;
const BROWSER_LIMIT = 2;

const [campaignId] = process.argv.slice(2);
if (!campaignId) {
  console.error("Usage: npx tsx src/rescue-contacts.ts <campaignId>");
  process.exit(1);
}

const prospects = await db
  .select()
  .from(guestPostProspects)
  .where(
    and(
      eq(guestPostProspects.campaignId, campaignId),
      isNull(guestPostProspects.exclusionReason),
      inArray(guestPostProspects.contactStatus, RETRYABLE)
    )
  );

if (prospects.length === 0) {
  console.log("No blocked/failed prospects found for this campaign.");
  process.exit(0);
}

console.log(`Rescuing ${prospects.length} blocked/failed contact lookup(s)${process.env.PROXY_URL ? " (browser pass through PROXY_URL)" : ""}\n`);

const doNotContact = await loadDoNotContactSet();
const limit = pLimit(CONCURRENCY);
const browserLimit = pLimit(BROWSER_LIMIT);
const browser = await createBrowserFetcher();
// Held in an object, not a bare `let`: TS's closure narrowing otherwise treats
// this as permanently null everywhere outside the function that reassigns it.
const capsolverHolder: { current: Awaited<ReturnType<typeof createCapsolverFetcher>> | null } = { current: null };

let done = 0;
let recovered = 0;

async function lookup(domain: string): Promise<{ result: ContactResult; via: string }> {
  const plain = await findContact(domain);
  if (plain.status !== "blocked") return { result: plain, via: "plain (this machine)" };

  const viaBrowser = await browserLimit(() => findContact(domain, browser.fetch));
  if (viaBrowser.status !== "blocked") return { result: viaBrowser, via: "browser" };

  if (!process.env.CAPSOLVER_API_KEY) return { result: viaBrowser, via: "browser" };
  capsolverHolder.current ??= await createCapsolverFetcher(process.env.CAPSOLVER_API_KEY);
  const viaCapsolver = await browserLimit(() => findContact(domain, capsolverHolder.current!.fetch));
  return { result: viaCapsolver, via: "capsolver" };
}

await Promise.all(
  prospects.map((prospect) =>
    limit(async () => {
      try {
        const { result, via } = await lookup(prospect.rootDomain);

        const moved = destinationExclusion(prospect.rootDomain, [result.finalDomain, result.successorDomain], doNotContact);
        if (moved) {
          await saveContactExclusion(prospect.id, moved.reason, `redirects to / moved to ${moved.destination} (${moved.reason})`, moved.destination);
        } else {
          await saveContactResult(prospect.id, result);
        }

        done++;
        const win = result.emailAddress || result.contactFormUrl;
        if (win) recovered++;
        const mark = win ? `RECOVERED via ${via}` : result.status;
        console.log(`[${String(done).padStart(String(prospects.length).length)}/${prospects.length}] ${prospect.rootDomain.padEnd(36)} ${mark}`);
      } catch (err) {
        done++;
        console.error(`[${done}/${prospects.length}] ${prospect.rootDomain}: unexpected error`, err);
      }
    })
  )
);

console.log(`\nRecovered ${recovered} of ${prospects.length}.`);
await browser.close();
await capsolverHolder.current?.close();
process.exit(0);

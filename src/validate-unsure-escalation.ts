import { db } from "./db/client.js";
import { findContact } from "./contact/findContact.js";
import { createBrowserFetcher } from "./contact/browserFetcher.js";

// READ-ONLY validation of the 2026-11-19 fix: runs the real production code
// (findContact + the real browser fetcher, both just edited) against real
// "unsure" domains already sitting in the live pool, and reports how many it
// can now actually classify as confirmed vs. genuinely dead. Writes nothing
// anywhere — not to guest_post_prospects, not to any other table.
//
// Usage:  npx tsx src/validate-unsure-escalation.ts [count]   (default 60)
//
// This is a one-off check, same spirit as rescue-contacts.ts — not run by the
// worker. Re-run it any time to sanity-check the escalation against a fresh
// sample before relying on the live numbers once it's wired into contactStage.ts.

const N = Number(process.argv[2] || 60);

async function main() {
  const rows = (await db.execute(`
    select root_domain from (
      select distinct root_domain from guestpost.guest_post_prospects
      where contact_form_url is not null and contact_reason like '%no form detected on it%'
    ) d
    order by random() limit ${N * 2}
  `)) as unknown as { root_domain: string }[];
  const domains = rows.map((r) => r.root_domain).slice(0, N);
  console.log(`Re-running the real production escalation against ${domains.length} real "unsure" domains.\n`);

  const browser = await createBrowserFetcher();
  const started = Date.now();
  const tally = new Map<string, number>();
  const examples = new Map<string, string[]>();
  let i = 0;
  for (const domain of domains) {
    i++;
    const t0 = Date.now();
    let bucket: string;
    let detail: string;
    try {
      // Mirrors contactStage.ts's escalation: we already know the plain-HTTP
      // pass was an unconfirmed guess, so go straight to the browser pass,
      // exactly as the escalation does.
      const viaBrowser = await findContact(domain, browser.fetch);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (viaBrowser.status === "has_email") { bucket = "CONFIRMED"; detail = `email found, ${secs}s`; }
      else if (viaBrowser.status === "form_only" && viaBrowser.formConfirmed) { bucket = "CONFIRMED"; detail = `real form seen, ${secs}s`; }
      else if (viaBrowser.status === "form_only") { bucket = "DROPPED"; detail = `still no form seen, ${secs}s`; }
      else { bucket = "DROPPED"; detail = `${viaBrowser.status}, ${secs}s`; }
    } catch (err) {
      bucket = "ERROR";
      detail = String((err as Error)?.message ?? err).slice(0, 60);
    }
    tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
    if (!examples.has(bucket)) examples.set(bucket, []);
    if (examples.get(bucket)!.length < 6) examples.get(bucket)!.push(`${domain} (${detail})`);
    console.log(`  ${i}/${domains.length}  ${domain}  ->  ${bucket} (${detail})`);
  }
  await browser.close();

  const totalSecs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n=== Real production code, run against real unsure domains (${totalSecs}s total) ===`);
  console.table([...tally.entries()].map(([k, n]) => ({ outcome: k, n, pct: `${(100 * n / domains.length).toFixed(1)}%` })));
  const confirmed = tally.get("CONFIRMED") ?? 0;
  console.log(`\nWould now be KEPT as a lead: ${confirmed}/${domains.length} (${(100 * confirmed / domains.length).toFixed(1)}%)`);
  console.log(`Would now be DROPPED before ever reaching FormBlast: ${domains.length - confirmed}/${domains.length}`);
  for (const [k, ex] of examples) console.log(`\n${k}\n  ${ex.join("\n  ")}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

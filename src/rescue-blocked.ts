import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import pLimit from "p-limit";
import * as XLSX from "xlsx";
import { findContact } from "./contact/findContact.js";
import { createBrowserFetcher } from "./contact/browserFetcher.js";
import { destinationExclusion } from "./contact/destination.js";

// "Rescue pass": re-runs a list of domains that were BLOCKED (or failed) when they were
// looked up from the server, but from THIS machine and THIS network instead — because
// blocklists are per-IP, so a site that refuses a data-centre address often serves a
// normal office or home connection.
//
// It never touches the database or the deployed app: it reads a spreadsheet (or .csv /
// .txt) of domains, looks each one up, and writes a results spreadsheet next to it.
//
//   npm run rescue -- "data/exports/blocked-leads_2026-09-21.xlsx"
//   npm run rescue -- list.csv --concurrency 3
//   npm run rescue -- list.csv --browser        (blocked sites get a second try in a real browser)
//
// Every sheet in a workbook is read (first column = domain), so the "Blocked" and
// "Failed (also retry)" sheets are both retried. PROXY_URL in .env is honoured, so the
// same script can be run through a proxy later.

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const concurrencyArg = args.indexOf("--concurrency");
const CONCURRENCY = Math.max(1, Number(concurrencyArg >= 0 ? args[concurrencyArg + 1] : 3) || 3);
const USE_BROWSER = args.includes("--browser");
// Browsers are heavy: never run more than 2 at once, whatever --concurrency says.
const BROWSER_LIMIT = 2;

if (!inputPath || !existsSync(inputPath)) {
  console.error('Usage: npm run rescue -- "<file.xlsx | file.csv | file.txt>" [--concurrency 3]');
  process.exit(1);
}

const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const cleanDomain = (raw: unknown): string | null => {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const host = new URL(text.includes("://") ? text : `https://${text}`).hostname.replace(/^www\./, "").toLowerCase();
    const tld = host.slice(host.lastIndexOf(".") + 1);
    return DOMAIN_SHAPE.test(host) && /^[a-z]{2,}$|^xn--/.test(tld) ? host : null;
  } catch {
    return null;
  }
};

// --- read the domains ---------------------------------------------------------------------
const workbook = XLSX.read(readFileSync(inputPath), { type: "buffer" });
const seen = new Map<string, string>(); // domain -> sheet it came from
for (const sheetName of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, { header: 1, blankrows: false });
  for (const row of rows) {
    const domain = cleanDomain(row[0]);
    if (domain && !seen.has(domain)) seen.set(domain, sheetName);
  }
}
const domains = [...seen.keys()];
if (domains.length === 0) {
  console.error("No domains found in that file (expected one per row in the first column).");
  process.exit(1);
}
console.log(`Retrying ${domains.length} domain(s) from this machine, ${CONCURRENCY} at a time.${process.env.PROXY_URL ? " (through PROXY_URL)" : ""}\n`);

// --- run them ------------------------------------------------------------------------------
interface Row {
  domain: string;
  fromSheet: string;
  result: string;
  email: string;
  form: string;
  notes: string;
}
const results: Row[] = [];
const noDnc = new Set<string>();
const limit = pLimit(CONCURRENCY);
const browserLimit = pLimit(BROWSER_LIMIT);
const browser = USE_BROWSER ? await createBrowserFetcher() : null;
if (browser) console.log("Browser mode: sites that are still blocked get a second try in a real Chromium.\n");
let done = 0;

await Promise.all(
  domains.map((domain) =>
    limit(async () => {
      let row: Row;
      try {
        let r = await findContact(domain);
        let viaBrowser = false;
        if (browser && r.status === "blocked") {
          const second = await browserLimit(() => findContact(domain, browser.fetch));
          if (second.emailAddress || second.contactFormUrl) {
            r = { ...second, reason: `recovered with a real browser; ${second.reason ?? ""}`.replace(/; $/, "") };
            viaBrowser = true;
          } else if (second.status !== "blocked") {
            r = second; // e.g. now readable but nothing found: a truer answer than "blocked"
          }
        }
        // Same rule as the app: a site that really leads to a big brand / parked page is not a lead.
        const moved = destinationExclusion(domain, [r.finalDomain, r.successorDomain], noDnc);
        row = moved
          ? { domain, fromSheet: seen.get(domain)!, result: `excluded (${moved.reason})`, email: "", form: "", notes: `redirects to ${moved.destination}` }
          : { domain, fromSheet: seen.get(domain)!, result: r.status, email: r.emailAddress ?? "", form: r.contactFormUrl ?? "", notes: r.reason ?? "" };
      } catch (err) {
        row = { domain, fromSheet: seen.get(domain)!, result: "error", email: "", form: "", notes: `unexpected error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200) };
      }
      results.push(row);
      done++;
      const mark = row.email || row.form ? (row.notes.startsWith("recovered with a real browser") ? "RECOVERED (browser)" : "RECOVERED") : row.result;
      console.log(`[${String(done).padStart(String(domains.length).length)}/${domains.length}] ${domain.padEnd(36)} ${mark}`);
    })
  )
);

// --- summary + results file --------------------------------------------------------------------
results.sort((a, b) => domains.indexOf(a.domain) - domains.indexOf(b.domain));
const recovered = results.filter((r) => r.email || r.form);
const stillBlocked = results.filter((r) => r.result === "blocked");
const byCode = new Map<string, number>();
for (const r of stillBlocked) {
  const code = /(?:homepage|contact page)[^:]*:\s*([a-z0-9_]+)/i.exec(r.notes)?.[1] ?? "other";
  byCode.set(code, (byCode.get(code) ?? 0) + 1);
}

console.log("\n=== Result =====================================================");
console.log(`Recovered (email or contact form): ${recovered.length} of ${results.length}  (${Math.round((recovered.length / results.length) * 100)}%)`);
console.log(`  with an email: ${results.filter((r) => r.email).length}   with a contact form: ${results.filter((r) => r.form).length}`);
console.log(`Still blocked: ${stillBlocked.length}${stillBlocked.length ? "  (" + [...byCode.entries()].map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") + ")" : ""}`);
console.log(`Nothing found / other: ${results.length - recovered.length - stillBlocked.length}`);

const header = ["Domain", "From sheet", "Result now", "Recovered?", "Email", "Contact form", "Notes"];
const sheet = XLSX.utils.aoa_to_sheet([
  header,
  ...results.map((r) => [r.domain, r.fromSheet, r.result, r.email || r.form ? "YES" : "", r.email, r.form, r.notes]),
]);
sheet["!cols"] = [{ wch: 34 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 38 }, { wch: 44 }, { wch: 70 }];
const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, sheet, "Rescue results");

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const outPath = join(dirname(inputPath), `rescue-results_${basename(inputPath).replace(/\.[^.]+$/, "")}_${stamp}.xlsx`);
writeFileSync(outPath, XLSX.write(out, { type: "buffer", bookType: "xlsx" }));
console.log(`\nResults saved to: ${outPath}`);
await browser?.close();
process.exit(0);

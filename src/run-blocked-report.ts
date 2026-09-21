import { readFileSync, writeFileSync } from "node:fs";
import { createCampaign } from "./db/writeResults.js";
import { exportCampaignCsv } from "./export/campaignCsv.js";
import { runCampaignWorker } from "./worker/runCampaign.js";

// Runs one list of sites through BOTH pipelines and writes one CSV per
// pipeline. Column sets are defined once in dashboard/lib/campaignCsv.ts and
// are identical to the dashboard's Export button.
//   1. full pipeline  : domain -> blog posts -> backlinks -> email/contact form
//   2. contact lookup : domain -> email/contact form (no crawling)

const input = process.argv[2] ?? "blocked-sites.csv";
const outPrefix = process.argv[3] ?? "blocked-sites-report";

const domains = [
  ...new Set(
    readFileSync(input, "utf-8")
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .map((l) => l.trim().split(",")[0])
      .filter((l) => l && l.toLowerCase() !== "domain")
      .map((l) => l.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase())
  ),
];
console.log(`Testing ${domains.length} sites through both pipelines\n`);

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

const fullId = await createCampaign(`Blocked sites - full pipeline (${stamp})`, {
  targetPostCount: 5,
  domains,
  mode: "discovery",
  autoContact: true, // full path: domains -> contacts in one run
});
const contactId = await createCampaign(`Blocked sites - contact lookup (${stamp})`, {
  targetPostCount: 5,
  domains,
  mode: "direct",
});

console.log("Running full pipeline (crawl -> backlinks -> filter -> contact lookup)...");
await runCampaignWorker(fullId);
console.log("Running contact lookup...");
await runCampaignWorker(contactId);

for (const [id, suffix] of [
  [fullId, "full-pipeline"],
  [contactId, "contact-lookup"],
] as const) {
  const { csv } = await exportCampaignCsv(id);
  const file = `${outPrefix}_${suffix}.csv`;
  writeFileSync(file, csv, "utf-8");
  console.log(`Wrote ${file}  (${csv.split("\r\n").length - 1} data rows)  campaign ${id}`);
}
process.exit(0);

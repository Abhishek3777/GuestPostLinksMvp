import { mkdirSync, writeFileSync } from "node:fs";
import { crawlDomain } from "./pipeline.js";
import { toCsvValue } from "./util.js";

// End-to-end Phase 1 smoke test: discover posts -> pick recent real articles
// (backfilling past non-article pages) -> extract external links -> write
// the 3-column result CSV.
const DOMAINS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "muskanquotes.com",
      "thepackagespk.com",
      "news-automotive.com",
      "ultrarunningshoes.com",
      "mencrossbodybags.com",
    ];

const TARGET_POSTS_PER_DOMAIN = 5;

interface OutputRow {
  guestPostUrl: string;
  externalLink: string;
  rootDomain: string;
  postDate: string;
  dateFound: string;
}

const rows: OutputRow[] = [];
const dateFound = new Date().toISOString().slice(0, 10);

for (const domain of DOMAINS) {
  console.log(`\n--- ${domain} ---`);
  const result = await crawlDomain(domain, { targetPostCount: TARGET_POSTS_PER_DOMAIN });

  console.log(
    `discovery: ${result.discoveryStatus}${result.discoverySource ? ` (${result.discoverySource})` : ""}`
  );
  console.log(`real articles processed: ${result.postsProcessed} (attempts: ${result.postsAttempted})`);
  if (result.skipped.length) {
    for (const s of result.skipped) console.log(`  skipped: ${s.url} -> ${s.reason}`);
  }
  console.log(`links found: ${result.rows.length}`);

  for (const row of result.rows) {
    rows.push({
      guestPostUrl: row.guestPostUrl,
      externalLink: row.externalLink,
      rootDomain: row.rootDomain,
      postDate: row.postDate ?? "",
      dateFound,
    });
  }
}

mkdirSync("data/exports", { recursive: true });
const header = "Guest Post URL,External Link,Root Domain,Post Date,Date Found";
const csv = [
  header,
  ...rows.map((r) =>
    [r.guestPostUrl, r.externalLink, r.rootDomain, r.postDate, r.dateFound].map(toCsvValue).join(",")
  ),
].join("\n");

writeFileSync("data/exports/phase1_test.csv", csv, "utf-8");
console.log(`\nWrote ${rows.length} rows to data/exports/phase1_test.csv`);

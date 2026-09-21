import { readFileSync } from "node:fs";
import { exclusionReason } from "./exclusions.js";

const DATA_DIR = "extracted/GuestPostLinks";
const empty = new Set<string>();

function readUtf8(path: string): string {
  return readFileSync(path, "utf-8").replace(/^﻿/, "");
}

// --- 1. Validate against the real excluded_domains.csv (594 real, audited
// exclusions from the legacy pipeline's actual production run) -------------
const excludedCsv = readUtf8(`${DATA_DIR}/excluded_domains.csv`);
const excludedRows = excludedCsv
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [domain, reason] = line.split(",");
    return { domain, reason };
  });

let excludedMismatches = 0;
const mismatchSamples: string[] = [];
for (const { domain, reason } of excludedRows) {
  const got = exclusionReason(domain, empty);
  if (got !== reason) {
    excludedMismatches++;
    if (mismatchSamples.length < 20) mismatchSamples.push(`  ${domain}: expected "${reason}", got "${got}"`);
  }
}
console.log(`excluded_domains.csv: ${excludedRows.length} real exclusions`);
console.log(`  matched: ${excludedRows.length - excludedMismatches}`);
console.log(`  mismatched: ${excludedMismatches}`);
if (mismatchSamples.length) console.log(mismatchSamples.join("\n"));

// --- 2. Validate against unique_domains.txt (17,463 domains the legacy
// pipeline actually KEPT as prospects — false positives here would mean we
// wrongly drop real, revenue-relevant prospects) ---------------------------
const uniqueDomains = readUtf8(`${DATA_DIR}/unique_domains.txt`)
  .split(/\r?\n/)
  .filter(Boolean);

let falsePositives = 0;
const fpSamples: string[] = [];
for (const domain of uniqueDomains) {
  const got = exclusionReason(domain, empty);
  if (got !== "") {
    falsePositives++;
    if (fpSamples.length < 20) fpSamples.push(`  ${domain}: wrongly excluded as "${got}"`);
  }
}
console.log(`\nunique_domains.txt: ${uniqueDomains.length} real kept prospects`);
console.log(`  correctly kept: ${uniqueDomains.length - falsePositives}`);
console.log(`  false positives: ${falsePositives}`);
if (fpSamples.length) console.log(fpSamples.join("\n"));

// --- 3. The Python file's own self-test cases (SMM resellers whose names
// contain brand substrings — the whole reason exact-label matching exists) -
const mustKeep = [
  "jaynike.com", "spotifystorm.com", "tiktokstorm.com", "youtubestorm.com",
  "pinterestclick.com", "streamoz.com", "betr.com.au", "bettycottlesinn.co.uk",
  "aagconstructions.com.au", "hellolaundry.co.uk", "phonecompass.com",
];
const mustDrop: [string, string][] = [
  ["cancer.gov", "gov_edu_tld"], ["dol.gov", "gov_edu_tld"], ["cdc.gov", "gov_edu_tld"],
  ["harvard.edu", "gov_edu_tld"], ["cornell.edu", "gov_edu_tld"], ["ncsc.gov.uk", "gov_edu_tld"],
  ["healthdirect.gov.au", "gov_edu_tld"], ["nuhsplus.edu.sg", "gov_edu_tld"],
  ["www.gov.uk", "gov_edu_tld"], ["www.nhs.uk", "excluded_domain"], // nhs.uk is a public suffix itself, caught via EXCLUDED_ROOT_DOMAINS not the suffix-label rule
  ["ahrefs.com", "big_brand"], ["wikipedia.org", "big_brand"], ["bbc.co.uk", "big_brand"],
  ["yahoo.com", "big_brand"], ["ehow.com", "big_brand"], ["google.com", "big_brand"],
  ["googleusercontent.com", "excluded_domain"], ["sedo.com", "parked_domain"],
  ["www.ahrefs.com", "big_brand"],
];

console.log("\nself-test — must keep:");
let selfTestFail = 0;
for (const d of mustKeep) {
  const got = exclusionReason(d, empty);
  if (got !== "") {
    selfTestFail++;
    console.log(`  ${d}: WRONGLY EXCLUDED as "${got}"`);
  }
}
console.log("self-test — must drop:");
for (const [d, expected] of mustDrop) {
  const got = exclusionReason(d, empty);
  if (got !== expected) {
    selfTestFail++;
    console.log(`  ${d}: expected "${expected}", got "${got}"`);
  }
}
console.log(selfTestFail === 0 ? "  all pass" : `  ${selfTestFail} FAILURES`);

// --- 4. Do-not-contact override test ---------------------------------------
const dnc = new Set(["example.com"]);
console.log("\ndo-not-contact override:");
console.log(`  example.com -> ${exclusionReason("example.com", dnc)} (expect do_not_contact)`);
console.log(`  https://www.example.com/contact -> ${exclusionReason("www.example.com", dnc)} (expect do_not_contact)`);

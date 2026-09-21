import { writeFileSync } from "node:fs";
import { exportCampaignCsv } from "./export/campaignCsv.js";

// Usage: tsx src/export-campaign.ts <campaignId> [outFile.csv]
const [campaignId, outFile] = process.argv.slice(2);
if (!campaignId) {
  console.error("Usage: tsx src/export-campaign.ts <campaignId> [outFile.csv]");
  process.exit(1);
}

const { name, mode, csv } = await exportCampaignCsv(campaignId);
const target = outFile ?? `${name.replace(/[^a-z0-9-]+/gi, "_")}_${mode === "direct" ? "contact-lookup" : "full-pipeline"}.csv`;
writeFileSync(target, csv, "utf-8");
console.log(`Wrote ${target}`);
process.exit(0);

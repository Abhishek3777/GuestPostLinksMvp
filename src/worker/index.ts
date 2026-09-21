import { runCampaignWorker } from "./runCampaign.js";

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("Usage: tsx src/worker/index.ts <campaignId>");
  process.exit(1);
}

console.log(`Starting worker for campaign ${campaignId}`);
await runCampaignWorker(campaignId);
console.log(`Campaign ${campaignId} finished`);
process.exit(0);

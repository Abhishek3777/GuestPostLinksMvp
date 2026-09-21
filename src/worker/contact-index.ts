import { runContactStage } from "./contactStage.js";

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("Usage: tsx src/worker/contact-index.ts <campaignId>");
  process.exit(1);
}

console.log(`Starting contact stage for campaign ${campaignId}`);
await runContactStage(campaignId);
console.log(`Contact stage for campaign ${campaignId} finished`);
process.exit(0);

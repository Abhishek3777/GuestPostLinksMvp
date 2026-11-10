import { runFilterStage } from "./filter/index.js";

// Standalone Stage 2 (filter) runner — same role as rescue-domains.ts for
// Stage 1 and worker/contact-index.ts for Stage 3. Needed after a rescue
// pass adds newly-recovered guest_post_links for an already-completed
// campaign, so those new backlink domains get turned into prospects before
// the contact stage can look them up. Safe to re-run: runFilterStage's save
// path is onConflictDoNothing, so already-filtered domains are untouched.
//
//   npx tsx src/filter-index.ts <campaignId>

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("Usage: npx tsx src/filter-index.ts <campaignId>");
  process.exit(1);
}

const result = await runFilterStage(campaignId);
console.log(`Filter stage for campaign ${campaignId}: ${result.kept} kept, ${result.excluded} excluded`, result.byReason);
process.exit(0);

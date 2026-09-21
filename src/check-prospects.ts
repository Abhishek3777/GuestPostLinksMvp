import { db } from "./db/client.js";
import { guestPostProspects } from "./db/schema.js";
import { eq } from "drizzle-orm";

const campaignId = process.argv[2];
const prospects = await db.select().from(guestPostProspects).where(eq(guestPostProspects.campaignId, campaignId));

console.log(`${prospects.length} unique prospects:`);
for (const p of prospects) {
  console.log(`  ${p.rootDomain.padEnd(30)} ${p.exclusionReason ?? "kept"}`);
}
process.exit(0);

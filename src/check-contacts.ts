import { db } from "./db/client.js";
import { guestPostProspects } from "./db/schema.js";
import { eq } from "drizzle-orm";

const campaignId = process.argv[2];
const prospects = await db.select().from(guestPostProspects).where(eq(guestPostProspects.campaignId, campaignId));

for (const p of prospects) {
  console.log(`${p.rootDomain}`);
  console.log(`  contactStatus: ${p.contactStatus}`);
  console.log(`  email: ${p.emailAddress ?? "-"}`);
  console.log(`  contactForm: ${p.contactFormUrl ?? "-"}`);
  console.log(`  finalDomain: ${p.finalDomain ?? "-"}`);
}
process.exit(0);

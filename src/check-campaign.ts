import { db } from "./db/client.js";
import { campaigns, domainCrawlStatus, guestPostLinks } from "./db/schema.js";
import { eq } from "drizzle-orm";

const campaignId = process.argv[2];
const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
console.log("Campaign:", campaign);

const statuses = await db.select().from(domainCrawlStatus).where(eq(domainCrawlStatus.campaignId, campaignId));
console.log(`\ndomain_crawl_status: ${statuses.length} rows`);
for (const s of statuses) console.log(`  ${s.domain} -> ${s.status} (${s.source ?? "-"})`);

const links = await db.select().from(guestPostLinks).where(eq(guestPostLinks.campaignId, campaignId));
console.log(`\nguest_post_links: ${links.length} rows`);

process.exit(0);

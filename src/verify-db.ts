import { db } from "./db/client.js";
import { campaigns, domainCrawlStatus, guestPostLinks } from "./db/schema.js";
import { eq, sql } from "drizzle-orm";

const [campaign] = await db.select().from(campaigns).orderBy(sql`created_at desc`).limit(1);
console.log("Latest campaign:", campaign);

const statuses = await db
  .select()
  .from(domainCrawlStatus)
  .where(eq(domainCrawlStatus.campaignId, campaign.id));
console.log(`\ndomain_crawl_status rows: ${statuses.length}`);
for (const s of statuses) {
  console.log(`  ${s.domain} -> ${s.status} (${s.source ?? "no source"}), posts: ${s.postsProcessed}`);
}

const links = await db.select().from(guestPostLinks).where(eq(guestPostLinks.campaignId, campaign.id));
console.log(`\nguest_post_links rows: ${links.length}`);
for (const l of links.slice(0, 5)) {
  console.log(`  ${l.guestPostUrl} -> ${l.externalLink} (${l.rootDomain})`);
}

process.exit(0);

import "dotenv/config";
import { db } from "./src/db/client.js";
import { sql } from "drizzle-orm";

const campaignId = "4eafc605-79d9-4947-a764-92074a142cfa";

const campaign = await db.execute(sql`
  select status, paused, failure_count, started_at, completed_at, contact_stage_status
  from guestpost.campaigns where id = ${campaignId}::uuid;
`);
console.log("campaign row:", campaign[0]);

const counts = await db.execute(sql`
  select count(*) as checked, max(checked_at) as last_checked_at, now() as server_now
  from guestpost.domain_crawl_status where campaign_id = ${campaignId}::uuid;
`);
console.log("domain_crawl_status:", counts[0]);

const recentRows = await db.execute(sql`
  select domain, status, checked_at from guestpost.domain_crawl_status
  where campaign_id = ${campaignId}::uuid order by checked_at desc limit 5;
`);
console.log("5 most recently checked domains:", recentRows);
process.exit(0);

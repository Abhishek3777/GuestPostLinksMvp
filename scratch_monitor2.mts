import "dotenv/config";
import { db } from "./src/db/client.js";
import { sql } from "drizzle-orm";

const campaignId = "4eafc605-79d9-4947-a764-92074a142cfa";
const start = Date.now();

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 20_000));
  const row = await db.execute(sql`select count(*) as n, max(checked_at) as last from guestpost.domain_crawl_status where campaign_id = ${campaignId}::uuid;`);
  console.log(`[+${Math.round((Date.now() - start) / 1000)}s] checked: ${row[0].n}, last write: ${row[0].last}`);
}
process.exit(0);

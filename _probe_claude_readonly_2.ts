import { sql } from "drizzle-orm";
import { db } from "./src/db/client.js";

const en = await db.execute<{ v: string }>(sql`SELECT unnest(enum_range(NULL::contact_stage_status))::text AS v`);
console.log("contact_stage_status:", en.map((r) => r.v).join(", "));

const cols = await db.execute<{ column_name: string }>(
  sql`SELECT column_name FROM information_schema.columns WHERE table_name='campaigns' AND column_name = 'incremental'`
);
console.log("campaigns.incremental column:", cols.length ? "present" : "MISSING");

const tables = await db.execute<{ table_name: string }>(
  sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('watched_sites','processed_posts') ORDER BY 1`
);
console.log("new tables present:", tables.map((t) => t.table_name).join(", ") || "none");

const open = await db.execute<{ name: string; status: string; cs: string; created_at: string }>(
  sql`SELECT name, status::text, contact_stage_status::text AS cs, created_at::text FROM campaigns
      WHERE status IN ('queued','running') OR contact_stage_status IN ('running','queued') ORDER BY created_at`
);
console.log("unfinished campaigns:", open.length);
for (const r of open) console.log(" -", r.name, `[${r.status}/${r.cs}]`, r.created_at);
process.exit(0);

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// Next.js dev-mode Fast Refresh re-evaluates this module on every save.
// Caching the client on globalThis (survives module reloads) avoids piling
// up orphaned connections against Supabase's pooler. Same pattern as
// the other Supabase-backed apps' db setup.
const globalForDb = globalThis as unknown as { postgresClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.postgresClient ??
  postgres(connectionString, {
    prepare: false,
    ssl: "require",
    // Supabase's pooler only hands out 15 real Postgres connections total
    // (Nano compute tier), shared with the worker. This + the worker's 10
    // (src/db/client.ts) leaves 1 spare for ad-hoc scripts, and stays under
    // the 15 cap even with both maxed out simultaneously — fixes dashboard
    // pages queueing for a connection behind an actively-crawling campaign.
    max: 4,
    // This DB is shared with ORR (dev project) — our tables live in their own
    // "guestpost" schema, not "public", so they never collide with ORR's own.
    connection: { search_path: "guestpost" },
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.postgresClient = client;
}

export const db = drizzle(client, { schema });

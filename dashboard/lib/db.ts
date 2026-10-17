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
    ssl: "require",
    // Session-mode pooler (port 5432 — see DATABASE_URL), not transaction-mode
    // (6543). This dashboard is a long-lived always-on process (Railway, not
    // serverless), which is exactly what session mode is for: one stable
    // backend connection per client for its whole lifetime, so a connection
    // going bad surfaces as a real, catchable error instead of silently
    // hanging forever — confirmed live, 2026-10-15, via Railway's own HTTP
    // logs showing pages taking 90s-300s+ and the browser giving up (status
    // 499) while the pooler quietly never answered. Session mode also
    // supports real prepared statements, so prepare is left at its default
    // (true) — unlike transaction mode, which requires it off.
    // Supabase's pooler caps out at 15 real connections total (confirmed
    // live, 2026-10-15), shared with the worker. This + the worker's 10
    // (src/db/client.ts) leaves headroom for ad-hoc scripts, and stays under
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

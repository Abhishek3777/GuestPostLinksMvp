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
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.postgresClient = client;
}

export const db = drizzle(client, { schema });

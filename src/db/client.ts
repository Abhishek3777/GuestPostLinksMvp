import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  // Supabase's transaction-mode pooler (port 6543) does not support prepared
  // statements — required off. Same setup as ACG Official's lib/db.ts.
  prepare: false,
  ssl: "require",
});

export const db = drizzle(client, { schema });
export type DB = typeof db;

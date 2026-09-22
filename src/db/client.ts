import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  // Supabase's transaction-mode pooler (port 6543) does not support prepared
  // statements — required off. Same setup as the other Supabase-backed apps.
  prepare: false,
  // Supabase requires TLS. DATABASE_SSL=disable exists only so the worker can be
  // tested against a plain local Postgres.
  ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
});

export const db = drizzle(client, { schema });
export type DB = typeof db;

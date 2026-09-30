import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  // Default is 10 — too tight once CRAWL_CONCURRENCY/CONTACT_CONCURRENCY are
  // raised well past that, since each concurrent domain eventually needs a
  // connection to save its result. Raised so DB access doesn't become the new
  // bottleneck the moment those are turned up.
  max: 25,
  // Supabase's transaction-mode pooler (port 6543) does not support prepared
  // statements — required off. Same setup as the other Supabase-backed apps.
  prepare: false,
  // Supabase requires TLS. DATABASE_SSL=disable exists only so the worker can be
  // tested against a plain local Postgres.
  ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
  // This DB is shared with ORR (dev project) — our tables live in their own
  // "guestpost" schema, not "public", so they never collide with ORR's own.
  connection: { search_path: "guestpost" },
});

export const db = drizzle(client, { schema });
export type DB = typeof db;

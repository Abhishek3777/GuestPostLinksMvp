import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  // Supabase's pooler only hands out 15 real Postgres connections total
  // (Nano compute tier), shared across this worker AND the dashboard. This
  // used to be 25 — on its own, more than the entire pool — which meant the
  // worker could starve the dashboard of connections whenever a campaign was
  // actively crawling (confirmed: dashboard queries were fast to execute but
  // slow end-to-end, stuck queueing for a free pooler slot). 10 here + 4 on
  // the dashboard (dashboard/lib/db.ts) leaves 1 spare for ad-hoc scripts,
  // and stays under the 15 cap even if both are maxed out simultaneously.
  // Per-domain DB writes are a small, fast fraction of crawl time (dominated
  // by network fetches), so this shouldn't meaningfully affect crawl speed.
  max: 10,
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
// What db.transaction()'s callback actually receives — structurally close to
// DB (same .select/.insert/.execute) but a distinct type, since a transaction
// isn't the top-level client. Functions that can run either directly against
// db or inside a transaction (e.g. under an advisory lock) take this instead.
export type Executor = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

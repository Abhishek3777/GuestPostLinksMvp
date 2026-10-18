import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  // Supabase's pooler caps out at 15 real connections total (confirmed live,
  // 2026-10-15 — probed empirically, 15 works, 20 fails with EMAXCONNSESSION),
  // shared across this worker AND the dashboard. This used to be 25 — on its
  // own, more than the entire pool — which meant the worker could starve the
  // dashboard of connections whenever a campaign was actively crawling
  // (confirmed: dashboard queries were fast to execute but slow end-to-end,
  // stuck queueing for a free pooler slot). 10 here + a modest share on the
  // dashboard (dashboard/lib/db.ts) leaves headroom for ad-hoc scripts, and
  // stays under the 15 cap even if both are maxed out simultaneously.
  // Per-domain DB writes are a small, fast fraction of crawl time (dominated
  // by network fetches), so this shouldn't meaningfully affect crawl speed.
  max: 10,
  // Confirmed live, 2026-10-18: without this, a session-mode connection
  // (below) never gives its slot back once opened, even when genuinely
  // unused — unlike transaction mode, which hands the real connection back
  // the instant a query finishes. Found all 15 of the pooler's total slots
  // permanently held (worker's 10 + dashboard's 4), every one idle, just
  // because nothing was closing them — leaving ad-hoc scripts and normal
  // headroom with nowhere to go. 20s is short enough to free a slot quickly
  // once it's actually idle, long enough that normal back-to-back crawl
  // activity never pays a reconnect cost.
  idle_timeout: 20,
  // Session-mode pooler (port 5432 — see DATABASE_URL), not transaction-mode
  // (6543). This worker is a long-lived process that holds connections open
  // for its whole lifetime, which is exactly what session mode is for: one
  // stable backend connection per client for the life of the session, so a
  // real connection failure surfaces as a real, catchable error instead of
  // silently vanishing into the pooler's internal transaction-reassignment
  // bookkeeping. Transaction mode is the right fit for brief, one-shot
  // callers (ad-hoc scripts), not an always-running worker — confirmed via
  // Railway's own HTTP logs showing the dashboard (same shared pool) hanging
  // for minutes with zero errors before this fix.
  // Session mode supports real prepared statements (each client keeps the
  // same backend connection), so prepare is left at its default (true) —
  // unlike transaction mode, which requires it off.
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

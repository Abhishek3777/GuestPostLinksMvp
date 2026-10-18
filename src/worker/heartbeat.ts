import os from "node:os";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// The worker writes a "still alive" timestamp to a single row every
// HEARTBEAT_INTERVAL_MS; the dashboard's admin health card reads it and calls
// the worker down once the row goes stale. A crashed, hung or redeploying
// process stops beating, so nothing else has to report the failure.
//
// Timestamps use the database clock (now()) on both the write and read side,
// so the worker's and dashboard's own clocks never have to agree.
const HEARTBEAT_INTERVAL_MS = 15_000;

const startedAt = new Date();

export async function startHeartbeat(): Promise<void> {
  // Created here (idempotent) so a deploy never depends on someone remembering
  // to run a migration first. Mirrored in dashboard/scripts/worker-heartbeat.sql.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS worker_heartbeat (
      id integer PRIMARY KEY DEFAULT 1,
      last_beat_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz NOT NULL DEFAULT now(),
      host text,
      pid integer
    )
  `);

  const beat = async () => {
    try {
      await db.execute(sql`
        INSERT INTO worker_heartbeat (id, last_beat_at, started_at, host, pid)
        VALUES (1, now(), ${startedAt.toISOString()}::timestamptz, ${os.hostname()}, ${process.pid})
        ON CONFLICT (id) DO UPDATE
          SET last_beat_at = now(), started_at = EXCLUDED.started_at, host = EXCLUDED.host, pid = EXCLUDED.pid
      `);
    } catch (err) {
      // A missed beat is exactly what the dashboard is meant to surface — it
      // must never take the worker down itself.
      console.error("[heartbeat] write failed:", (err as Error).message);
    }
  };

  await beat();
  setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS).unref();
}

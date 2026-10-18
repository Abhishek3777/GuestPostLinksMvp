import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// The worker beats every 15s (src/worker/heartbeat.ts). One missed beat is
// noise (a slow DB write); three in a row means it's not coming back by itself.
const STALE_AFTER_S = 45;
const DOWN_AFTER_S = 120;

export type WorkerHealth = {
  state: "healthy" | "stale" | "down" | "unknown";
  // Seconds since the last beat, by the database's clock. null = never beat.
  lastBeatAgoS: number | null;
  uptimeS: number | null;
  host: string | null;
  runningJobs: number;
  queuedJobs: number;
};

export async function getWorkerHealth(): Promise<WorkerHealth> {
  const jobs = await db.execute<{ running: number; queued: number }>(sql`
    SELECT
      count(*) FILTER (WHERE status = 'running' OR contact_stage_status = 'running')::int AS running,
      count(*) FILTER (WHERE (status = 'queued' AND paused = false) OR contact_stage_status = 'queued')::int AS queued
    FROM campaigns
  `);
  const runningJobs = jobs[0]?.running ?? 0;
  const queuedJobs = jobs[0]?.queued ?? 0;

  let beat: { ago: number; up: number; host: string | null } | undefined;
  try {
    const rows = await db.execute<{ ago: number; up: number; host: string | null }>(sql`
      SELECT extract(epoch FROM now() - last_beat_at)::float AS ago,
             extract(epoch FROM now() - started_at)::float AS up,
             host
      FROM worker_heartbeat WHERE id = 1
    `);
    beat = rows[0];
  } catch {
    // Table doesn't exist yet: no worker running the heartbeat build has ever started.
  }

  if (!beat) return { state: "unknown", lastBeatAgoS: null, uptimeS: null, host: null, runningJobs, queuedJobs };

  const state = beat.ago < STALE_AFTER_S ? "healthy" : beat.ago < DOWN_AFTER_S ? "stale" : "down";
  return { state, lastBeatAgoS: beat.ago, uptimeS: beat.up, host: beat.host, runningJobs, queuedJobs };
}

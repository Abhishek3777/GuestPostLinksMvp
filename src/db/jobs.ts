import { sql } from "drizzle-orm";
import { db } from "./client.js";

// The campaigns table is the job queue. The dashboard only ever writes
// status="queued" (a new campaign) or contact_stage_status="queued" (the manual
// "Run Contact Scrape" button); the worker daemon claims those rows here.
// Claiming is one atomic UPDATE ... FOR UPDATE SKIP LOCKED, so a job can never
// be handed out twice even if two daemons ever polled at the same moment.

export async function claimNextCampaign(): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE campaigns SET status = 'running'
    WHERE id = (
      SELECT id FROM campaigns WHERE status = 'queued' AND paused = false
      ORDER BY created_at LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  return rows[0]?.id ?? null;
}

export async function claimNextContactStage(): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE campaigns SET contact_stage_status = 'running', contact_stage_started_at = now()
    WHERE id = (
      SELECT id FROM campaigns WHERE contact_stage_status = 'queued' AND paused = false
      ORDER BY created_at LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  return rows[0]?.id ?? null;
}

// Run once when the daemon starts. The daemon is the only thing that ever sets
// "running", so any row still marked running at startup belongs to a previous
// daemon that was killed (deploy, crash, reboot). Put those back in the queue:
// Stage 1 skips domains it already checked and Stage 3 only touches prospects
// still "pending", so re-running never redoes finished work.
//
// Assumes ONE daemon instance. Don't run two against the same database.
export async function requeueInterruptedJobs(): Promise<{ campaigns: number; contactStages: number }> {
  const campaigns = await db.execute(sql`UPDATE campaigns SET status = 'queued' WHERE status = 'running' RETURNING id`);

  // A requeued campaign that was mid-Stage-3 (direct mode / auto contact) runs
  // Stage 3 again as part of its own job, so it must not also sit in the
  // separate contact queue.
  await db.execute(
    sql`UPDATE campaigns SET contact_stage_status = 'not_started'
        WHERE status = 'queued' AND contact_stage_status IN ('running', 'queued')`
  );

  // Whatever is still "running" now is a manually-triggered contact stage on an
  // already-finished campaign.
  const contactStages = await db.execute(
    sql`UPDATE campaigns SET contact_stage_status = 'queued' WHERE contact_stage_status = 'running' RETURNING id`
  );

  return { campaigns: campaigns.length, contactStages: contactStages.length };
}

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./client.js";
import { campaigns, guestPostProspects } from "./schema.js";
import type { ContactResult } from "../contact/findContact.js";
import { pickEmail } from "../contact/pickEmail.js";

export async function getKeptPendingProspects(campaignId: string) {
  return db
    .select()
    .from(guestPostProspects)
    .where(
      and(
        eq(guestPostProspects.campaignId, campaignId),
        isNull(guestPostProspects.exclusionReason),
        eq(guestPostProspects.contactStatus, "pending")
      )
    );
}

export async function saveContactResult(prospectId: string, result: ContactResult) {
  await db
    .update(guestPostProspects)
    .set({
      contactStatus: result.status,
      emailAddress: result.emailAddress,
      contactFormUrl: result.contactFormUrl,
      finalDomain: result.finalDomain,
      contactReason: result.reason,
      contactCheckedAt: new Date(),
    })
    .where(eq(guestPostProspects.id, prospectId));
}

// A prospect whose site turned out to redirect to (or say it moved to) somewhere
// the exclusion rules reject. It is taken out of the kept leads, with the
// reason, and no contact details are stored for it.
export async function saveContactExclusion(prospectId: string, reason: string, note: string, finalDomain: string | null) {
  await db
    .update(guestPostProspects)
    .set({
      exclusionReason: reason,
      contactStatus: "no_contact_found",
      emailAddress: null,
      contactFormUrl: null,
      finalDomain,
      contactReason: note,
      contactCheckedAt: new Date(),
    })
    .where(eq(guestPostProspects.id, prospectId));
}

export async function updateContactStageStatus(
  campaignId: string,
  status: (typeof campaigns.$inferInsert)["contactStageStatus"],
  extra: Partial<{ contactStageStartedAt: Date; contactStageCompletedAt: Date }> = {}
) {
  await db.update(campaigns).set({ contactStageStatus: status, ...extra }).where(eq(campaigns.id, campaignId));
}

// Same idea as recordCampaignCrash in src/db/writeResults.ts, for Stage 3.
// Something escaped every per-prospect try/catch in runContactStage — retry
// a few times automatically before leaving it as a genuine "failed" for a
// human to look at. Always safe to resume: the stage only ever looks up
// prospects still "pending", so nothing already found gets redone or lost.
const MAX_AUTO_RETRIES = 3;

export async function recordContactStageCrash(campaignId: string): Promise<"retrying" | "gave_up"> {
  const [row] = await db
    .update(campaigns)
    .set({ failureCount: sql`${campaigns.failureCount} + 1` })
    .where(eq(campaigns.id, campaignId))
    .returning({ failureCount: campaigns.failureCount });

  if ((row?.failureCount ?? MAX_AUTO_RETRIES + 1) <= MAX_AUTO_RETRIES) {
    await db.update(campaigns).set({ contactStageStatus: "queued", paused: false }).where(eq(campaigns.id, campaignId));
    return "retrying";
  }
  await db
    .update(campaigns)
    .set({ contactStageStatus: "failed", paused: false, contactStageCompletedAt: new Date() })
    .where(eq(campaigns.id, campaignId));
  return "gave_up";
}

// Picks contact_email for every kept prospect that has a real emailAddress
// but no pick yet — one batch pass, not per-prospect during the stage's own
// run (pickEmail is cheap, but there's no reason to run it thousands of times
// inline in the busy lookup loop when it only ever needs to happen once).
// Called automatically when a contact stage completes (see contactStage.ts);
// re-running it for an already-backfilled campaign is harmless — same input,
// same deterministic pick, just redone.
export async function backfillContactEmails(campaignId: string): Promise<number> {
  const rows = await db
    .select({ id: guestPostProspects.id, emailAddress: guestPostProspects.emailAddress })
    .from(guestPostProspects)
    .where(
      and(
        eq(guestPostProspects.campaignId, campaignId),
        isNull(guestPostProspects.exclusionReason),
        isNotNull(guestPostProspects.emailAddress)
      )
    );
  if (rows.length === 0) return 0;

  const updates = rows
    .map((r) => ({
      id: r.id,
      contactEmail: pickEmail(r.emailAddress!.split(",").map((e) => e.trim()).filter(Boolean)).primary,
    }))
    .filter((u): u is { id: string; contactEmail: string } => u.contactEmail !== null);
  if (updates.length === 0) return 0;

  // Batched bulk UPDATE-from-VALUES, not one round trip per row — thousands
  // of individually-awaited UPDATEs would make this the slow part of
  // finishing a campaign; one statement per 5000 rows is not.
  for (let i = 0; i < updates.length; i += 5000) {
    const chunk = updates.slice(i, i + 5000);
    const values = sql.join(
      chunk.map((u) => sql`(${u.id}::uuid, ${u.contactEmail}::text)`),
      sql`, `
    );
    await db.execute(sql`
      update guestpost.guest_post_prospects as p
      set contact_email = v.contact_email
      from (values ${values}) as v(id, contact_email)
      where p.id = v.id
    `);
  }
  return updates.length;
}

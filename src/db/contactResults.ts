import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client.js";
import { campaigns, guestPostProspects } from "./schema.js";
import type { ContactResult } from "../contact/findContact.js";

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

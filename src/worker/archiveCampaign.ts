// Runs once per campaign, 7+ days after it completes (see the scheduled job
// in archiveOldCampaigns.ts). Freezes the same numbers the dashboard tiles
// show live today into campaigns.archived_summary, then deletes the raw
// detail tables — nothing reads them again after this (the export already
// happened, and the one fact that matters going forward, which domains were
// actually contacted, is already independently captured in
// domain_contact_ledger). campaign_domains, do_not_contact, watched_sites
// and domain_contact_ledger are never touched by this — see
// campaignDeletionRequirements.md.
import { and, eq, isNull, isNotNull, or, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { campaigns, campaignDomains, domainCrawlStatus, guestPostLinks, guestPostProspects } from "../db/schema.js";

export interface ArchivedSummary {
  totalDomains: number;
  linksCount: number;
  domainStatusCounts: { status: string; count: number }[];
  prospectReasonCounts: { reason: string | null; count: number }[];
  contactStats: {
    kept: number;
    looked: number;
    reached: number;
    formsConfirmed: number;
    totalEmails: number;
    hasEmailStatus: number;
  };
  contactFilterCounts: Record<string, number>;
}

const CONTACT_FILTER_KEYS = ["has_email", "has_form", "both", "form_only", "none", "blocked", "failed", "pending"] as const;

function contactFilterCondition(key: (typeof CONTACT_FILTER_KEYS)[number]) {
  switch (key) {
    case "has_email":
      return isNotNull(guestPostProspects.emailAddress);
    case "has_form":
      return isNotNull(guestPostProspects.contactFormUrl);
    case "both":
      return and(isNotNull(guestPostProspects.emailAddress), isNotNull(guestPostProspects.contactFormUrl));
    case "form_only":
      return eq(guestPostProspects.contactStatus, "form_only");
    case "none":
      return eq(guestPostProspects.contactStatus, "no_contact_found");
    case "blocked":
      return eq(guestPostProspects.contactStatus, "blocked");
    case "failed":
      return inArray(guestPostProspects.contactStatus, ["timeout", "dns_error", "error"]);
    case "pending":
      return eq(guestPostProspects.contactStatus, "pending");
  }
}

// Same queries as dashboard/services/campaigns.service.ts's
// getCampaignDetail/getCampaignContactStats/getCampaignContactFilterCounts/
// getCampaignProspectReasonCounts — duplicated rather than imported (the two
// projects don't share a module boundary), kept behaviorally identical on
// purpose so the frozen numbers match what was actually shown live before
// archiving.
async function computeSummary(campaignId: string): Promise<ArchivedSummary> {
  const kept = and(eq(guestPostProspects.campaignId, campaignId), isNull(guestPostProspects.exclusionReason));

  const [
    [{ totalDomains }],
    [{ linksCount }],
    domainStatusCounts,
    prospectReasonCounts,
    [{ keptCount }],
    [{ looked }],
    [{ reached }],
    [{ formsConfirmed }],
    [{ totalEmails }],
    [{ hasEmailStatus }],
    ...filterCounts
  ] = await Promise.all([
    db.select({ totalDomains: sql<number>`count(*)::int` }).from(campaignDomains).where(eq(campaignDomains.campaignId, campaignId)),
    db
      .select({ linksCount: sql<number>`count(distinct ${guestPostLinks.rootDomain})::int` })
      .from(guestPostLinks)
      .where(eq(guestPostLinks.campaignId, campaignId)),
    db
      .select({ status: domainCrawlStatus.status, count: sql<number>`count(*)::int` })
      .from(domainCrawlStatus)
      .where(eq(domainCrawlStatus.campaignId, campaignId))
      .groupBy(domainCrawlStatus.status),
    db
      .select({ reason: guestPostProspects.exclusionReason, count: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(eq(guestPostProspects.campaignId, campaignId))
      .groupBy(guestPostProspects.exclusionReason),
    db.select({ keptCount: sql<number>`count(*)::int` }).from(guestPostProspects).where(kept),
    db
      .select({ looked: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(and(kept, isNotNull(guestPostProspects.contactCheckedAt))),
    db
      .select({ reached: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(and(kept, or(isNotNull(guestPostProspects.emailAddress), isNotNull(guestPostProspects.contactFormUrl)))),
    db
      .select({ formsConfirmed: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(and(kept, isNotNull(guestPostProspects.contactFormUrl), sql`${guestPostProspects.contactReason} ~* 'contact form confirmed'`)),
    db
      .select({
        totalEmails: sql<number>`coalesce(sum(case when ${guestPostProspects.emailAddress} is not null then array_length(string_to_array(${guestPostProspects.emailAddress}, ','), 1) else 0 end), 0)::int`,
      })
      .from(guestPostProspects)
      .where(kept),
    db
      .select({ hasEmailStatus: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(and(kept, eq(guestPostProspects.contactStatus, "has_email"))),
    ...CONTACT_FILTER_KEYS.map((k) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(guestPostProspects)
        .where(and(kept, contactFilterCondition(k)))
    ),
  ]);

  const contactFilterCounts = Object.fromEntries(CONTACT_FILTER_KEYS.map((k, i) => [k, filterCounts[i][0].count]));

  return {
    totalDomains,
    linksCount,
    domainStatusCounts,
    prospectReasonCounts,
    contactStats: { kept: keptCount, looked, reached, formsConfirmed, totalEmails, hasEmailStatus },
    contactFilterCounts,
  };
}

const ARCHIVE_AFTER_DAYS = 7;

// Completed 7+ days ago and not yet archived — the actual "once a week old"
// rule from campaignDeletionRequirements.md.
export async function findCampaignsEligibleForArchiving(): Promise<string[]> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, "completed"),
        isNull(campaigns.archivedAt),
        sql`${campaigns.completedAt} < now() - make_interval(days => ${ARCHIVE_AFTER_DAYS})`
      )
    );
  return rows.map((r) => r.id);
}

// Returns false (does nothing) for a campaign that isn't actually eligible —
// callers should only call this on campaigns already confirmed completed
// 7+ days ago and not yet archived, but this is a safe no-op either way.
export async function archiveCampaign(campaignId: string): Promise<boolean> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign || campaign.status !== "completed" || campaign.archivedAt) return false;

  const summary = await computeSummary(campaignId);

  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ archivedAt: new Date(), archivedSummary: summary }).where(eq(campaigns.id, campaignId));
    await tx.delete(guestPostProspects).where(eq(guestPostProspects.campaignId, campaignId));
    await tx.delete(guestPostLinks).where(eq(guestPostLinks.campaignId, campaignId));
    await tx.delete(domainCrawlStatus).where(eq(domainCrawlStatus.campaignId, campaignId));
    await tx.delete(campaignDomains).where(eq(campaignDomains.campaignId, campaignId));
  });

  return true;
}

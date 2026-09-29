import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects } from "@/lib/schema";

// undefined userId (admin) = every campaign. Otherwise, only ones they started.
export async function listCampaigns(userId?: string) {
  const allCampaigns = await db
    .select()
    .from(campaigns)
    .where(userId ? eq(campaigns.createdBy, userId) : undefined)
    .orderBy(desc(campaigns.createdAt));

  const [domainCounts, statusCounts, linkCounts, keptProspectCounts] = await Promise.all([
    db
      .select({ campaignId: campaignDomains.campaignId, count: sql<number>`count(*)::int` })
      .from(campaignDomains)
      .groupBy(campaignDomains.campaignId),
    db
      .select({ campaignId: domainCrawlStatus.campaignId, count: sql<number>`count(*)::int` })
      .from(domainCrawlStatus)
      .groupBy(domainCrawlStatus.campaignId),
    db
      .select({ campaignId: guestPostLinks.campaignId, count: sql<number>`count(*)::int` })
      .from(guestPostLinks)
      .groupBy(guestPostLinks.campaignId),
    db
      .select({ campaignId: guestPostProspects.campaignId, count: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(sql`${guestPostProspects.exclusionReason} IS NULL`)
      .groupBy(guestPostProspects.campaignId),
  ]);

  const domainMap = new Map(domainCounts.map((d) => [d.campaignId, d.count]));
  const statusMap = new Map(statusCounts.map((d) => [d.campaignId, d.count]));
  const linkMap = new Map(linkCounts.map((d) => [d.campaignId, d.count]));
  const keptMap = new Map(keptProspectCounts.map((d) => [d.campaignId, d.count]));

  return allCampaigns.map((c) => ({
    ...c,
    totalDomains: domainMap.get(c.id) ?? 0,
    domainsChecked: statusMap.get(c.id) ?? 0,
    totalLinks: linkMap.get(c.id) ?? 0,
    keptProspects: keptMap.get(c.id) ?? 0,
  }));
}

export async function getCampaignDetail(id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;

  const [domainStatuses, links, prospects, domainRows] = await Promise.all([
    db
      .select()
      .from(domainCrawlStatus)
      .where(eq(domainCrawlStatus.campaignId, id))
      .orderBy(desc(domainCrawlStatus.checkedAt)),
    db.select().from(guestPostLinks).where(eq(guestPostLinks.campaignId, id)).orderBy(desc(guestPostLinks.dateFound)),
    db
      .select()
      .from(guestPostProspects)
      .where(eq(guestPostProspects.campaignId, id))
      .orderBy(desc(guestPostProspects.createdAt)),
    db.select({ domain: campaignDomains.domain }).from(campaignDomains).where(eq(campaignDomains.campaignId, id)),
  ]);

  // The exact domains the user sent (sorted — campaign_domains has no order).
  const domains = domainRows.map((r) => r.domain).sort();

  return { campaign, domainStatuses, links, prospects, domains, totalDomains: domains.length };
}

export async function createCampaign(opts: {
  name: string;
  mode: "discovery" | "direct";
  autoContact?: boolean;
  // Monitoring runs: read only posts earlier runs have not seen, and do not
  // hand over a lead an earlier run already found.
  incremental?: boolean;
  daysWindow?: number;
  targetPostCount: number;
  domains: string[];
  createdBy?: string;
}) {
  const [row] = await db
    .insert(campaigns)
    .values({
      name: opts.name,
      mode: opts.mode,
      autoContact: opts.mode === "discovery" && Boolean(opts.autoContact),
      incremental: opts.mode === "discovery" && Boolean(opts.incremental),
      daysWindow: opts.daysWindow,
      targetPostCount: opts.targetPostCount,
      createdBy: opts.createdBy,
    })
    .returning({ id: campaigns.id });

  // Batched: one INSERT carries at most ~65k parameters, which a very large
  // domain list would exceed.
  for (let i = 0; i < opts.domains.length; i += 5000) {
    await db
      .insert(campaignDomains)
      .values(opts.domains.slice(i, i + 5000).map((domain) => ({ campaignId: row.id, domain })));
  }

  // Nothing to launch: the campaign row is inserted as "queued" and the worker
  // daemon (a separate service) picks it up.
  return row.id;
}

// For a "discovery" campaign that already finished Stage 1+2 — queues Stage 3
// (contact scraping) on its kept prospects for the worker daemon. Separate
// trigger: you get to see the kept-prospect count before committing scrape
// effort to it. The condition makes a repeat click a no-op.
export async function startContactStage(campaignId: string) {
  await db
    .update(campaigns)
    .set({ contactStageStatus: "queued", paused: false })
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.mode, "discovery"),
        eq(campaigns.status, "completed"),
        eq(campaigns.contactStageStatus, "not_started")
      )
    );
}

// Pause: only sets a flag. The worker stops starting new sites, lets the ones already
// in flight finish, parks the campaign, and moves on to the next queued one.
// Only meaningful while something is queued or running.
export async function pauseCampaign(campaignId: string) {
  await db
    .update(campaigns)
    .set({ paused: true })
    .where(
      and(
        eq(campaigns.id, campaignId),
        or(
          inArray(campaigns.status, ["queued", "running"]),
          inArray(campaigns.contactStageStatus, ["queued", "running"])
        )
      )
    );
}

// Resume: clears the flag. A parked campaign is already "queued", so the worker
// claims it again and continues with whatever is unfinished.
export async function resumeCampaign(campaignId: string) {
  await db.update(campaigns).set({ paused: false }).where(and(eq(campaigns.id, campaignId), eq(campaigns.paused, true)));
}

// Contact statuses worth another try: the site refused us, or the request timed out /
// failed. Blocks in particular come and go (the same site can pass on one attempt and
// challenge the next), so a later retry recovers some of them.
export const RETRYABLE_CONTACT_STATUSES = ["blocked", "timeout", "dns_error", "error"] as const;

// Puts every blocked/failed lead of a FINISHED campaign back to "pending" and queues its
// contact stage. The worker's normal contact lookup then handles exactly those leads;
// everything already reached is left untouched.
export async function retryFailedContacts(
  campaignId: string
): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return { ok: false, error: "Campaign not found" };
  if (c.status !== "completed" || !["completed", "failed"].includes(c.contactStageStatus)) {
    return { ok: false, error: "Wait for the campaign to finish before retrying." };
  }

  const reset = await db
    .update(guestPostProspects)
    .set({ contactStatus: "pending", contactReason: null, contactCheckedAt: null })
    .where(
      and(
        eq(guestPostProspects.campaignId, campaignId),
        isNull(guestPostProspects.exclusionReason),
        inArray(guestPostProspects.contactStatus, [...RETRYABLE_CONTACT_STATUSES])
      )
    )
    .returning({ id: guestPostProspects.id });
  if (reset.length === 0) return { ok: false, error: "Nothing to retry." };

  await db.update(campaigns).set({ contactStageStatus: "queued", paused: false }).where(eq(campaigns.id, campaignId));
  return { ok: true, queued: reset.length };
}

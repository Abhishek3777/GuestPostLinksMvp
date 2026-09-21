import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects } from "@/lib/schema";

export async function listCampaigns() {
  const allCampaigns = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));

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
    .set({ contactStageStatus: "queued" })
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.mode, "discovery"),
        eq(campaigns.status, "completed"),
        eq(campaigns.contactStageStatus, "not_started")
      )
    );
}

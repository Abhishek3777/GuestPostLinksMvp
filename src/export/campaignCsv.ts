import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects, profiles } from "../db/schema.js";
// The column definitions live in ONE file — the dashboard's — and are reused
// here, so a CSV from the terminal has exactly the columns of the Export button.
import { buildCampaignCsv } from "../../dashboard/lib/campaignCsv.js";

export async function exportCampaignCsv(campaignId: string): Promise<{ name: string; mode: string; csv: string }> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [domainRows, crawl, links, prospects] = await Promise.all([
    db.select({ domain: campaignDomains.domain }).from(campaignDomains).where(eq(campaignDomains.campaignId, campaignId)),
    db.select().from(domainCrawlStatus).where(eq(domainCrawlStatus.campaignId, campaignId)),
    db.select().from(guestPostLinks).where(eq(guestPostLinks.campaignId, campaignId)),
    db.select().from(guestPostProspects).where(eq(guestPostProspects.campaignId, campaignId)),
  ]);

  // Same claimer lookup as the dashboard's getCampaignExportData — keeps the
  // terminal CSV and the Export button's CSV identical, as the comment above
  // promises.
  const claimerIds = [...new Set(prospects.map((p) => p.claimedByCampaignId).filter((v): v is string => v !== null))];
  const claimers = claimerIds.length
    ? await db
        .select({ id: campaigns.id, name: campaigns.name, ownerEmail: profiles.email })
        .from(campaigns)
        .leftJoin(profiles, eq(campaigns.createdBy, profiles.id))
        .where(inArray(campaigns.id, claimerIds))
    : [];
  const claimerById = new Map(claimers.map((c) => [c.id, c]));
  const prospectsWithClaimer = prospects.map((p) => {
    const claimer = p.claimedByCampaignId ? claimerById.get(p.claimedByCampaignId) : undefined;
    return { ...p, claimedByCampaignName: claimer?.name ?? null, claimedByOwnerEmail: claimer?.ownerEmail ?? null };
  });

  const csv = buildCampaignCsv({
    mode: campaign.mode,
    contactStageStatus: campaign.contactStageStatus,
    domains: domainRows.map((r) => r.domain).sort(),
    crawl,
    links,
    prospects: prospectsWithClaimer,
  });

  return { name: campaign.name, mode: campaign.mode, csv };
}

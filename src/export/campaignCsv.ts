import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects } from "../db/schema.js";
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

  const csv = buildCampaignCsv({
    mode: campaign.mode,
    contactStageStatus: campaign.contactStageStatus,
    domains: domainRows.map((r) => r.domain).sort(),
    crawl,
    links,
    prospects,
  });

  return { name: campaign.name, mode: campaign.mode, csv };
}

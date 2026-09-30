import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, processedPosts } from "./schema.js";
import type { CrawlDomainResult } from "../pipeline.js";

export async function createCampaign(
  name: string,
  opts: {
    daysWindow?: number;
    targetPostCount: number;
    domains: string[];
    mode?: "discovery" | "direct";
    autoContact?: boolean;
    incremental?: boolean;
  }
) {
  const [row] = await db
    .insert(campaigns)
    .values({
      name,
      daysWindow: opts.daysWindow,
      targetPostCount: opts.targetPostCount,
      mode: opts.mode ?? "discovery",
      autoContact: opts.autoContact ?? false,
      incremental: opts.incremental ?? false,
    })
    .returning({ id: campaigns.id });

  const uniqueDomains = [...new Set(opts.domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  // Batched: one INSERT caps at ~65k bound parameters, which a very large
  // domain list would exceed.
  for (let i = 0; i < uniqueDomains.length; i += 5000) {
    await db.insert(campaignDomains).values(uniqueDomains.slice(i, i + 5000).map((domain) => ({ campaignId: row.id, domain })));
  }

  return row.id;
}

export async function getCampaign(campaignId: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  return row;
}

export async function getCampaignDomains(campaignId: string) {
  const rows = await db
    .select({ domain: campaignDomains.domain })
    .from(campaignDomains)
    .where(eq(campaignDomains.campaignId, campaignId));
  return rows.map((r) => r.domain);
}

// Domains that already have a Stage 1 result for this campaign — lets a
// restarted worker (crash, manual re-run, machine restart mid-run) skip
// straight past everything it already finished instead of re-crawling a
// large domain list from scratch. This is the actual resumability the
// original spec called out as non-negotiable at scale.
export async function getCheckedDomains(campaignId: string): Promise<Set<string>> {
  const rows = await db
    .select({ domain: domainCrawlStatus.domain })
    .from(domainCrawlStatus)
    .where(eq(domainCrawlStatus.campaignId, campaignId));
  return new Set(rows.map((r) => r.domain));
}

// Post URLs earlier runs already finished with for this domain — a monitoring
// run skips them so it only reads NEW posts.
export async function getProcessedPostUrls(domain: string): Promise<Set<string>> {
  const rows = await db
    .select({ url: processedPosts.postUrl })
    .from(processedPosts)
    .where(eq(processedPosts.sourceDomain, domain));
  return new Set(rows.map((r) => r.url));
}

export async function updateCampaignStatus(
  campaignId: string,
  status: (typeof campaigns.$inferInsert)["status"],
  extra: Partial<{ startedAt: Date; completedAt: Date }> = {}
) {
  // A finished campaign is no longer pausable; clearing the flag stops a stale
  // "paused" from blocking a later manual contact-stage run.
  const finished = status === "completed" || status === "failed";
  await db.update(campaigns).set({ status, ...(finished ? { paused: false } : {}), ...extra }).where(eq(campaigns.id, campaignId));
}

export async function saveCrawlResult(campaignId: string, result: CrawlDomainResult) {
  await db
    .insert(domainCrawlStatus)
    .values({
      campaignId,
      domain: result.domain,
      status: result.discoveryStatus as (typeof domainCrawlStatus.$inferInsert)["status"],
      source: result.discoverySource as (typeof domainCrawlStatus.$inferInsert)["source"],
      reason: result.reason,
      postsProcessed: result.postsProcessed,
    })
    .onConflictDoUpdate({
      target: [domainCrawlStatus.campaignId, domainCrawlStatus.domain],
      set: {
        status: result.discoveryStatus as (typeof domainCrawlStatus.$inferInsert)["status"],
        source: result.discoverySource as (typeof domainCrawlStatus.$inferInsert)["source"],
        reason: result.reason,
        postsProcessed: result.postsProcessed,
        checkedAt: new Date(),
      },
    });

  // Remember every post this run finished with (any kind of campaign), so a
  // later monitoring run does not read it again.
  if (result.processedPosts.length) {
    await db
      .insert(processedPosts)
      .values(
        result.processedPosts.map((p) => ({
          sourceDomain: result.domain,
          postUrl: p.url,
          outcome: p.outcome,
          linksFound: p.linksFound,
        }))
      )
      .onConflictDoNothing();
  }

  if (result.rows.length === 0) return;

  await db
    .insert(guestPostLinks)
    .values(
      result.rows.map((r) => ({
        campaignId,
        sourceDomain: result.domain,
        guestPostUrl: r.guestPostUrl,
        externalLink: r.externalLink,
        rootDomain: r.rootDomain,
        postDate: r.postDate ? new Date(r.postDate) : null,
      }))
    )
    .onConflictDoNothing(); // re-running the same campaign/post/link combo is a no-op, not a duplicate
}

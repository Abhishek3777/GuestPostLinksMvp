import { and, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects, profiles, watchedSites } from "@/lib/schema";
import type { CurrentUser } from "@/lib/auth";

// Same "who's allowed to see which sites" rule as sites.service.ts — kept in
// sync by hand since this is a small, separate concern (analytics, not CRUD).
function ownershipCondition(viewer: CurrentUser) {
  return viewer.role === "admin" ? undefined : eq(watchedSites.createdBy, viewer.id);
}

export interface LeaderboardRow {
  id: string;
  domain: string;
  active: boolean;
  isPriority: boolean;
  ownerEmail: string | null;
  totalLinksFound: number;
  totalPostsFound: number;
  lastRunAt: Date | null;
  lastCampaignId: string | null;
  crawlStatus: string | null;
  // The exact gap that caused the 2026-10-21 audit confusion: a site whose
  // last run came back empty/blocked but which has real history — not
  // actually broken, just not reflecting it in the one-run view.
  looksEmptyButHasHistory: boolean;
}

const ROW_SELECT = {
  id: watchedSites.id,
  domain: watchedSites.domain,
  active: watchedSites.active,
  isPriority: watchedSites.isPriority,
  ownerEmail: profiles.email,
  totalLinksFound: watchedSites.totalLinksFound,
  totalPostsFound: watchedSites.totalPostsFound,
  lastRunAt: watchedSites.lastRunAt,
  lastCampaignId: watchedSites.lastCampaignId,
  crawlStatus: domainCrawlStatus.status,
};

function toRow(r: {
  id: string;
  domain: string;
  active: boolean;
  isPriority: boolean;
  ownerEmail: string | null;
  totalLinksFound: number;
  totalPostsFound: number;
  lastRunAt: Date | null;
  lastCampaignId: string | null;
  crawlStatus: string | null;
}): LeaderboardRow {
  return { ...r, looksEmptyButHasHistory: r.totalLinksFound > 0 && (r.crawlStatus === "blocked" || r.crawlStatus === "no_posts_found" || r.crawlStatus === "error") };
}

// Ranked by all-time backlinks — "which domains are actually paying off."
// `q`: a search narrows past the normal top-50 cap (a searched-for domain
// might not be in it) — raised to 1000 whenever a search term is present.
export async function listLeaderboard(viewer: CurrentUser, q?: string): Promise<LeaderboardRow[]> {
  const conditions = [q ? ilike(watchedSites.domain, `%${q}%`) : undefined, ownershipCondition(viewer)].filter((c) => c !== undefined);
  const rows = await db
    .select(ROW_SELECT)
    .from(watchedSites)
    .leftJoin(profiles, eq(profiles.id, watchedSites.createdBy))
    .leftJoin(
      domainCrawlStatus,
      and(eq(domainCrawlStatus.campaignId, watchedSites.lastCampaignId), eq(domainCrawlStatus.domain, watchedSites.domain))
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(watchedSites.totalLinksFound))
    .limit(q ? 1000 : 50);
  return rows.map(toRow);
}

// The admin-curated "we especially want to see this one" list.
export async function listPrioritySites(viewer: CurrentUser, q?: string): Promise<LeaderboardRow[]> {
  const conditions = [
    eq(watchedSites.isPriority, true),
    q ? ilike(watchedSites.domain, `%${q}%`) : undefined,
    ownershipCondition(viewer),
  ].filter((c) => c !== undefined);
  const rows = await db
    .select(ROW_SELECT)
    .from(watchedSites)
    .leftJoin(profiles, eq(profiles.id, watchedSites.createdBy))
    .leftJoin(
      domainCrawlStatus,
      and(eq(domainCrawlStatus.campaignId, watchedSites.lastCampaignId), eq(domainCrawlStatus.domain, watchedSites.domain))
    )
    .where(and(...conditions))
    .orderBy(desc(watchedSites.totalLinksFound));
  return rows.map(toRow);
}

export async function setSitePriority(id: string, isPriority: boolean, viewer: CurrentUser) {
  if (viewer.role !== "admin") return;
  await db.update(watchedSites).set({ isPriority }).where(eq(watchedSites.id, id));
}

export interface FilterBreakdown {
  reason: string; // "kept" for a non-excluded prospect
  count: number;
}

export interface DomainAnalytics {
  id: string;
  domain: string;
  active: boolean;
  isPriority: boolean;
  ownerEmail: string | null;
  totalLinksFound: number;
  totalPostsFound: number;
  lastRunAt: Date | null;
  lastCampaignId: string | null;
  lastCampaignName: string | null;
  crawlStatus: string | null;
  crawlReason: string | null;
  lastRunPostsProcessed: number | null;
  lastRunLinks: number | null;
  // Exclusion-reason breakdown for the last run ONLY — guest_post_prospects
  // (like guest_post_links) gets deleted ~1 week after a campaign completes,
  // so there is no all-time version of this yet, same limitation the
  // Backlinks/Guest posts columns had before totalLinksFound/totalPostsFound
  // existed. Null when the last campaign's detail rows are already gone.
  lastRunFilterBreakdown: FilterBreakdown[] | null;
}

export async function getDomainAnalytics(id: string, viewer: CurrentUser): Promise<DomainAnalytics | null> {
  const conditions = [eq(watchedSites.id, id), ownershipCondition(viewer)].filter((c) => c !== undefined);
  const [site] = await db
    .select({
      id: watchedSites.id,
      domain: watchedSites.domain,
      active: watchedSites.active,
      isPriority: watchedSites.isPriority,
      ownerEmail: profiles.email,
      totalLinksFound: watchedSites.totalLinksFound,
      totalPostsFound: watchedSites.totalPostsFound,
      lastRunAt: watchedSites.lastRunAt,
      lastCampaignId: watchedSites.lastCampaignId,
      lastCampaignName: campaigns.name,
      crawlStatus: domainCrawlStatus.status,
      crawlReason: domainCrawlStatus.reason,
      lastRunPostsProcessed: domainCrawlStatus.postsProcessed,
    })
    .from(watchedSites)
    .leftJoin(profiles, eq(profiles.id, watchedSites.createdBy))
    .leftJoin(campaigns, eq(campaigns.id, watchedSites.lastCampaignId))
    .leftJoin(
      domainCrawlStatus,
      and(eq(domainCrawlStatus.campaignId, watchedSites.lastCampaignId), eq(domainCrawlStatus.domain, watchedSites.domain))
    )
    .where(and(...conditions));
  if (!site) return null;

  let lastRunLinks: number | null = null;
  let lastRunFilterBreakdown: FilterBreakdown[] | null = null;

  if (site.lastCampaignId) {
    const links = await db
      .select({ rootDomain: guestPostLinks.rootDomain })
      .from(guestPostLinks)
      .where(and(eq(guestPostLinks.campaignId, site.lastCampaignId), eq(guestPostLinks.sourceDomain, site.domain)));
    lastRunLinks = links.length;

    const clientDomains = [...new Set(links.map((l) => l.rootDomain))];
    if (clientDomains.length) {
      const prospects = await db
        .select({ exclusionReason: guestPostProspects.exclusionReason, c: count() })
        .from(guestPostProspects)
        .where(and(eq(guestPostProspects.campaignId, site.lastCampaignId), inArray(guestPostProspects.rootDomain, clientDomains)))
        .groupBy(guestPostProspects.exclusionReason);
      lastRunFilterBreakdown = prospects
        .map((p) => ({ reason: p.exclusionReason ?? "kept", count: p.c }))
        .sort((a, b) => b.count - a.count);
    } else {
      lastRunFilterBreakdown = [];
    }
  }

  return { ...site, lastRunLinks, lastRunFilterBreakdown };
}

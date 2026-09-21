import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, domainCrawlStatus, guestPostLinks, watchedSites } from "@/lib/schema";
import { createCampaign } from "./campaigns.service";

export const SITES_PAGE_SIZE = 50;

// A monitoring run only looks at posts published since the previous run. The
// very first run of a site has no "previous", so it looks this far back.
const FIRST_RUN_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
// Cap on new posts read per site per run — generous, since the date window
// already keeps the number of candidates small.
const MONITOR_TARGET_POSTS = 20;

export type SiteFilter = "all" | "active" | "paused";

export async function listSites(opts: { q?: string; filter?: SiteFilter; page?: number }) {
  const { q, filter = "all" } = opts;
  const page = Math.max(1, opts.page ?? 1);

  const conditions = [
    q ? ilike(watchedSites.domain, `%${q}%`) : undefined,
    filter === "active" ? eq(watchedSites.active, true) : undefined,
    filter === "paused" ? eq(watchedSites.active, false) : undefined,
  ].filter((c) => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }], [{ activeTotal, allTotal }]] = await Promise.all([
    db
      .select({
        id: watchedSites.id,
        domain: watchedSites.domain,
        active: watchedSites.active,
        addedAt: watchedSites.addedAt,
        lastRunAt: watchedSites.lastRunAt,
        lastCampaignId: watchedSites.lastCampaignId,
        campaignStatus: campaigns.status,
        contactStageStatus: campaigns.contactStageStatus,
        crawlStatus: domainCrawlStatus.status,
        crawlReason: domainCrawlStatus.reason,
      })
      .from(watchedSites)
      .leftJoin(campaigns, eq(campaigns.id, watchedSites.lastCampaignId))
      .leftJoin(
        domainCrawlStatus,
        and(eq(domainCrawlStatus.campaignId, watchedSites.lastCampaignId), eq(domainCrawlStatus.domain, watchedSites.domain))
      )
      .where(where)
      .orderBy(desc(watchedSites.addedAt), watchedSites.domain)
      .limit(SITES_PAGE_SIZE)
      .offset((page - 1) * SITES_PAGE_SIZE),
    db.select({ total: count() }).from(watchedSites).where(where),
    db
      .select({
        allTotal: count(),
        activeTotal: sql<number>`count(*) filter (where ${watchedSites.active})::int`,
      })
      .from(watchedSites),
  ]);

  // Backlinks each listed site produced in its own last run.
  const campaignIds = [...new Set(rows.map((r) => r.lastCampaignId).filter((id): id is string => Boolean(id)))];
  const linkCounts = campaignIds.length
    ? await db
        .select({ campaignId: guestPostLinks.campaignId, sourceDomain: guestPostLinks.sourceDomain, links: count() })
        .from(guestPostLinks)
        .where(inArray(guestPostLinks.campaignId, campaignIds))
        .groupBy(guestPostLinks.campaignId, guestPostLinks.sourceDomain)
    : [];
  const linksBySite = new Map(linkCounts.map((l) => [`${l.campaignId}|${l.sourceDomain}`, l.links]));

  // Most recent run across all sites, so the page can link to its results.
  const [latest] = await db
    .select({ id: watchedSites.lastCampaignId, at: watchedSites.lastRunAt })
    .from(watchedSites)
    .where(sql`${watchedSites.lastCampaignId} is not null`)
    .orderBy(desc(watchedSites.lastRunAt))
    .limit(1);

  return {
    sites: rows.map((r) => ({
      ...r,
      links: r.lastCampaignId ? (linksBySite.get(`${r.lastCampaignId}|${r.domain}`) ?? 0) : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / SITES_PAGE_SIZE)),
    activeTotal: activeTotal ?? 0,
    allTotal: allTotal ?? 0,
    latestCampaignId: latest?.id ?? null,
  };
}

// Domains are validated loosely on purpose (anything host-shaped): a typo simply
// shows up as a failed site after a run, which is more useful than rejecting it.
const LOOKS_LIKE_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function addSites(domains: string[]): Promise<{ added: number; skipped: number; invalid: number }> {
  const cleaned = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  const valid = cleaned.filter((d) => LOOKS_LIKE_DOMAIN.test(d));
  if (!valid.length) return { added: 0, skipped: 0, invalid: cleaned.length };

  let added = 0;
  for (let i = 0; i < valid.length; i += 1000) {
    const inserted = await db
      .insert(watchedSites)
      .values(valid.slice(i, i + 1000).map((domain) => ({ domain })))
      .onConflictDoNothing()
      .returning({ id: watchedSites.id });
    added += inserted.length;
  }
  return { added, skipped: valid.length - added, invalid: cleaned.length - valid.length };
}

export async function setSiteActive(id: string, active: boolean) {
  await db.update(watchedSites).set({ active }).where(eq(watchedSites.id, id));
}

// Bulk switch. With a search term / filter it applies to exactly what the list is
// showing, so "deactivate all" on a filtered view never touches other sites.
export async function setSitesActive(active: boolean, opts: { q?: string; filter?: SiteFilter } = {}) {
  const conditions = [
    opts.q ? ilike(watchedSites.domain, `%${opts.q}%`) : undefined,
    opts.filter === "active" ? eq(watchedSites.active, true) : undefined,
    opts.filter === "paused" ? eq(watchedSites.active, false) : undefined,
  ].filter((c) => c !== undefined);
  const updated = await db
    .update(watchedSites)
    .set({ active })
    .where(conditions.length ? and(...conditions) : undefined)
    .returning({ id: watchedSites.id });
  return updated.length;
}

export async function removeSite(id: string) {
  await db.delete(watchedSites).where(eq(watchedSites.id, id));
}

export type RunResult =
  | { ok: true; campaignId: string; siteCount: number; daysWindow: number }
  | { ok: false; error: string; campaignId?: string };

// Turns the ACTIVE sites into one discovery campaign (crawl, filter, then
// contact lookup automatically) and stamps each site with that run. From the
// second run on it only reads posts newer than the oldest last-run among the
// active sites, so results are new backlinks, not the same ones again.
export async function runActiveSites(): Promise<RunResult> {
  // One monitoring run at a time: a double click, or a second person clicking
  // while the first run is still going, must not queue the same sites twice.
  const busy = await db
    .select({ id: campaigns.id })
    .from(watchedSites)
    .innerJoin(campaigns, eq(campaigns.id, watchedSites.lastCampaignId))
    .where(
      or(
        inArray(campaigns.status, ["queued", "running"]),
        inArray(campaigns.contactStageStatus, ["queued", "running"])
      )
    )
    .limit(1);
  if (busy.length) {
    return { ok: false, error: "A monitoring run is still in progress. Wait for it to finish, or open its results.", campaignId: busy[0].id };
  }

  const active = await db
    .select({ id: watchedSites.id, domain: watchedSites.domain, lastRunAt: watchedSites.lastRunAt })
    .from(watchedSites)
    .where(eq(watchedSites.active, true));
  if (!active.length) return { ok: false, error: "No active sites to run. Activate at least one site." };

  const now = Date.now();
  const windows = active.map((s) =>
    s.lastRunAt ? Math.ceil((now - s.lastRunAt.getTime()) / 86_400_000) + 1 : FIRST_RUN_DAYS
  );
  // One window per campaign, so take the widest: a site that has not run for a
  // month must not be limited by one that ran yesterday.
  const daysWindow = Math.min(MAX_WINDOW_DAYS, windows.reduce((widest, w) => Math.max(widest, w), 2));

  const campaignId = await createCampaign({
    name: `Monitor run — ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`,
    mode: "discovery",
    autoContact: true,
    incremental: true,
    daysWindow,
    targetPostCount: MONITOR_TARGET_POSTS,
    domains: active.map((s) => s.domain),
  });

  await db
    .update(watchedSites)
    .set({ lastRunAt: new Date(now), lastCampaignId: campaignId })
    .where(eq(watchedSites.active, true));

  return { ok: true, campaignId, siteCount: active.length, daysWindow };
}

import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, domainCrawlStatus, guestPostLinks, watchedSites } from "@/lib/schema";
import { createCampaign } from "./campaigns.service";

export const SITES_PAGE_SIZE = 50;

// A monitoring run only looks at posts published since the previous run. The
// very first run of a site has no "previous", so it looks this far back.
const FIRST_RUN_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
// Effectively no cap on new posts read per site per run — the date window
// already keeps the number of real candidates small, and discovery itself
// (WP API/sitemap/feed/HTML-fallback) bounds how many URLs come back per
// domain, so this just needs to be higher than any realistic count.
const MONITOR_TARGET_POSTS = 1000;

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

// Same two bulk ops, but for an explicit set of checked rows rather than
// "everything the current search/filter shows".
export async function setSitesActiveByIds(ids: string[], active: boolean) {
  if (!ids.length) return 0;
  const updated = await db.update(watchedSites).set({ active }).where(inArray(watchedSites.id, ids)).returning({ id: watchedSites.id });
  return updated.length;
}

export async function removeSitesByIds(ids: string[]) {
  if (!ids.length) return 0;
  const deleted = await db.delete(watchedSites).where(inArray(watchedSites.id, ids)).returning({ id: watchedSites.id });
  return deleted.length;
}

// The domains a campaign would use if it ran the standing list right now —
// for the New Campaign page's "pull in the monitor list" option. Not
// necessarily what a Sites-to-monitor RUN would use (that's active sites at
// the moment it fires), but the same query.
export async function listActiveSiteDomains(): Promise<string[]> {
  const rows = await db.select({ domain: watchedSites.domain }).from(watchedSites).where(eq(watchedSites.active, true));
  return rows.map((r) => r.domain);
}

export type RunResult =
  | { ok: true; campaignId: string; siteCount: number; daysWindow: number }
  | { ok: false; error: string; campaignId?: string };

// Turns the ACTIVE sites into one discovery campaign (crawl, filter, then
// contact lookup automatically) and stamps each site with that run. From the
// second run on it only reads posts newer than the oldest last-run among the
// active sites, so results are new backlinks, not the same ones again.
//
// Queuing a second run while one is still queued/running is ALLOWED — the
// worker only processes one campaign at a time anyway, so this just waits its
// turn. The one thing that's imprecise if you do stack runs: `lastRunAt` gets
// stamped here, at QUEUE time, not when the crawl actually happens, so a run
// queued while an earlier one is still pending will compute its "since when"
// window from a lastRunAt the earlier run hasn't actually acted on yet. This
// never causes duplicate contact work or double-counted leads — processed_posts
// (global) and the already_found / claimed_by_teammate filter-stage checks
// still catch anything genuinely re-processed — worst case is an unnecessarily
// wide or narrow date window on the stacked run, not a data-correctness bug.
export async function runActiveSites(
  name?: string,
  createdBy?: string,
  overrides: { targetPostCount?: number; daysWindow?: number } = {}
): Promise<RunResult> {
  const active = await db
    .select({ id: watchedSites.id, domain: watchedSites.domain, lastRunAt: watchedSites.lastRunAt })
    .from(watchedSites)
    .where(eq(watchedSites.active, true));
  if (!active.length) return { ok: false, error: "No active sites to run. Activate at least one site." };

  const now = Date.now();
  let daysWindow: number;
  if (overrides.daysWindow) {
    daysWindow = overrides.daysWindow;
  } else {
    const windows = active.map((s) =>
      s.lastRunAt ? Math.ceil((now - s.lastRunAt.getTime()) / 86_400_000) + 1 : FIRST_RUN_DAYS
    );
    // One window per campaign, so take the widest: a site that has not run for a
    // month must not be limited by one that ran yesterday.
    daysWindow = Math.min(MAX_WINDOW_DAYS, windows.reduce((widest, w) => Math.max(widest, w), 2));
  }

  const trimmedName = name?.trim();
  const campaignId = await createCampaign({
    name: trimmedName || `Monitor run — ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`,
    mode: "discovery",
    autoContact: true,
    incremental: true,
    daysWindow,
    targetPostCount: overrides.targetPostCount || MONITOR_TARGET_POSTS,
    domains: active.map((s) => s.domain),
    createdBy,
  });

  await db
    .update(watchedSites)
    .set({ lastRunAt: new Date(now), lastCampaignId: campaignId })
    .where(eq(watchedSites.active, true));

  return { ok: true, campaignId, siteCount: active.length, daysWindow };
}

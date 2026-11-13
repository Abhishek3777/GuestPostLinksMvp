import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, getTableColumns, gt, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { computeCampaignEta, type CampaignEta, type Events } from "@/lib/campaignEta";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects, profiles, type CachedDetailStats } from "@/lib/schema";

// Every raw-row table on the campaign page is paginated at this size — never
// fetch more than one page of rows at a time. This is the fix for the Sep 30
// egress spike: the page used to fetch every domain/link/prospect row on every
// load (and every 4s while auto-refresh was on), which was fine at test-campaign
// scale (dozens of rows) and catastrophic at real scale (tens of thousands).
export const ROWS_PAGE_SIZE = 50;

export async function getCampaign(id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return campaign ?? null;
}

// Who started a campaign, for the admin-only "Started by" label. Null for legacy
// campaigns with no owner (or whose owner's profile was since deleted).
export async function getCampaignOwnerEmail(createdBy: string | null) {
  if (!createdBy) return null;
  const [row] = await db.select({ email: profiles.email }).from(profiles).where(eq(profiles.id, createdBy));
  return row?.email ?? null;
}

type CountMaps = { domainMap: Map<string, number>; statusMap: Map<string, number>; linkMap: Map<string, number>; keptMap: Map<string, number> };

function emptyCountMaps(): CountMaps {
  return { domainMap: new Map(), statusMap: new Map(), linkMap: new Map(), keptMap: new Map() };
}

// Same "kind" + UNION ALL shape the old single query used — just now callable
// with either the active-campaign set (always fresh) or the inactive set
// (cached, see below).
async function queryCampaignCounts(campaignIds: string[]): Promise<CountMaps> {
  const maps = emptyCountMaps();
  if (campaignIds.length === 0) return maps;
  const idList = sql.join(campaignIds.map((id) => sql`${id}`), sql`, `);
  const counts = await db.execute<{ kind: "domains" | "statuses" | "links" | "kept"; campaign_id: string; n: number }>(sql`
    select 'domains' as kind, ${campaignDomains.campaignId} as campaign_id, count(*)::int as n
      from ${campaignDomains} where ${campaignDomains.campaignId} in (${idList}) group by ${campaignDomains.campaignId}
    union all
    select 'statuses', ${domainCrawlStatus.campaignId}, count(*)::int
      from ${domainCrawlStatus} where ${domainCrawlStatus.campaignId} in (${idList}) group by ${domainCrawlStatus.campaignId}
    union all
    select 'links', ${guestPostLinks.campaignId}, count(*)::int
      from ${guestPostLinks} where ${guestPostLinks.campaignId} in (${idList}) group by ${guestPostLinks.campaignId}
    union all
    select 'kept', ${guestPostProspects.campaignId}, count(*)::int
      from ${guestPostProspects}
      where ${guestPostProspects.exclusionReason} is null and ${guestPostProspects.campaignId} in (${idList})
      group by ${guestPostProspects.campaignId}
  `);
  const mapByKind = { domains: maps.domainMap, statuses: maps.statusMap, links: maps.linkMap, kept: maps.keptMap } as const;
  for (const row of counts) {
    mapByKind[row.kind].set(row.campaign_id, row.n);
  }
  return maps;
}

// Short stale-while-revalidate cache for the ACTIVE-campaign set specifically
// — this was deliberately "always fresh, every load, no cache" when it was
// just a handful of small campaigns, but confirmed live, 2026-11-13: once a
// single active campaign reaches real scale (Shilpi: 25,158 domains,
// hundreds of thousands of related rows), that same "just re-count it every
// load" query is itself expensive enough to hit Postgres's own
// statement_timeout — this became the dominant cost the moment the
// INACTIVE-campaign scan above got cached away. A few seconds of staleness
// on an in-progress campaign's displayed counts is an explicitly acceptable
// tradeoff here (not guessed at — this is what was asked for), the same way
// the inactive set's cache already was.
const ACTIVE_COUNTS_CACHE_MS = 60_000;
let activeCountsCache: { key: string; at: number; maps: CountMaps } | null = null;
let activeCountsRefreshing: Promise<void> | null = null;

async function getActiveCampaignCounts(campaignIds: string[]): Promise<CountMaps> {
  if (campaignIds.length === 0) return emptyCountMaps();
  const key = [...campaignIds].sort().join(",");

  // Cold start, or the active set itself changed (a campaign started/
  // finished) — this one call has to actually wait either way.
  if (!activeCountsCache || activeCountsCache.key !== key) {
    const maps = await queryCampaignCounts(campaignIds);
    activeCountsCache = { key, at: Date.now(), maps };
    return maps;
  }

  const age = Date.now() - activeCountsCache.at;
  if (age >= ACTIVE_COUNTS_CACHE_MS && !activeCountsRefreshing) {
    activeCountsRefreshing = queryCampaignCounts(campaignIds)
      .then((maps) => {
        activeCountsCache = { key, at: Date.now(), maps };
      })
      .catch((err) => console.error("[listCampaigns] active counts refresh failed:", err))
      .finally(() => {
        activeCountsRefreshing = null;
      });
  }
  return activeCountsCache.maps;
}

// A campaign actively doing work right now, by the SAME compound check
// getCampaignEtas already uses — not just `status`, since a campaign can show
// status "completed" (crawl done) while contactStageStatus is still "running"
// (confirmed real shape, seen repeatedly: Priya's and Deepika's campaigns both
// had this split). Only this small set (at most one — the worker only ever
// runs one job at a time) gets queried fresh on every call; everything else
// is cache-eligible below.
function isCampaignActive(c: { status: string; contactStageStatus: string }): boolean {
  return c.status === "queued" || c.status === "running" || c.contactStageStatus === "queued" || c.contactStageStatus === "running";
}

// Stale-while-revalidate for the inactive campaigns' counts — these are the
// expensive part (scanning guest_post_links/guest_post_prospects/
// domain_crawl_status/campaign_domains), and for a completed/failed/paused
// campaign the real numbers underneath literally cannot change, so serving a
// few seconds' old snapshot costs nothing in correctness. Added 2026-10-26
// after this query was confirmed as the dashboard's main load-time cost
// (~1.3-1.6s) AND, live during testing, the thing that tipped the shared
// Supabase pool into EMAXCONNSESSION — caching it cuts both the steady-state
// load time and how often this specific query competes for a connection.
//
// Deliberately NOT a hard-guaranteed freshness ceiling: refresh only
// triggers when a request actually arrives while the cache is stale (lazy),
// not on an independent timer. With this dashboard's actual usage pattern
// (checked often during active work) that keeps staleness close to
// INACTIVE_COUNTS_CACHE_MS in practice, but if the page goes unvisited for a
// while, the next viewer can see an older snapshot than that — acceptable
// here since nothing is ever wrong, just not perfectly fresh, and the
// alternative (an always-ticking background timer) would query the DB every
// cycle even with zero visitors.
type CachedCountsRow = { id: string; totalDomains: number; domainsChecked: number; totalLinks: number; keptProspects: number };

// Writes the just-computed counts onto each campaign's own row, permanently
// — see the cached_* columns' comment in src/db/schema.ts. One UPDATE per
// campaign rather than a single batched statement: in steady state this
// only ever runs for campaigns that just went inactive for the first time
// since the last load (a handful at most), not the whole table.
async function persistCachedCounts(rows: CachedCountsRow[]): Promise<void> {
  await Promise.all(
    rows.map((r) =>
      db
        .update(campaigns)
        .set({
          cachedTotalDomains: r.totalDomains,
          cachedDomainsChecked: r.domainsChecked,
          cachedTotalLinks: r.totalLinks,
          cachedKeptProspects: r.keptProspects,
        })
        .where(eq(campaigns.id, r.id))
    )
  );
}

// undefined userId (admin) = every campaign. Otherwise, only ones they started.
export async function listCampaigns(userId?: string) {
  const allCampaignRows = await db
    .select({ campaign: campaigns, ownerEmail: profiles.email })
    .from(campaigns)
    .leftJoin(profiles, eq(campaigns.createdBy, profiles.id))
    .where(userId ? eq(campaigns.createdBy, userId) : undefined)
    .orderBy(desc(campaigns.createdAt));
  const allCampaigns = allCampaignRows.map((r) => ({ ...r.campaign, ownerEmail: r.ownerEmail }));

  const activeIds = allCampaigns.filter(isCampaignActive).map((c) => c.id);
  const inactive = allCampaigns.filter((c) => !isCampaignActive(c));

  // An inactive campaign's real numbers can never change again — once
  // cached_* is written for it, every future load reads it straight off the
  // row below, no query at all. Only a campaign that just went inactive
  // since the last time this ran (cached_* still null) needs computing.
  // This replaces a query that re-scanned EVERY inactive campaign on EVERY
  // page load — confirmed live, 2026-11-13, as the actual cause of 10-15s
  // loads, and separately confirmed hitting Postgres's own statement_timeout
  // outright as the data grew.
  const uncachedInactive = inactive.filter((c) => c.cachedTotalDomains === null);

  // Archived campaigns are a separate case: their detail rows (the same
  // ones the live query below reads) are already DELETED by archiveCampaign
  // — querying them would silently cache zeros forever. Their real numbers
  // are frozen in archivedSummary instead, computed from the exact same
  // data before it was deleted — use that, no query needed at all.
  const uncachedArchived = uncachedInactive.filter((c) => c.archivedAt && c.archivedSummary);
  const uncachedLive = uncachedInactive.filter((c) => !(c.archivedAt && c.archivedSummary));
  const uncachedLiveIds = uncachedLive.map((c) => c.id);

  const [activeMaps, freshInactiveMaps] = await Promise.all([
    getActiveCampaignCounts(activeIds),
    queryCampaignCounts(uncachedLiveIds),
  ]);

  const archivedRows: CachedCountsRow[] = uncachedArchived.map((c) => {
    const s = c.archivedSummary!;
    return {
      id: c.id,
      totalDomains: s.totalDomains,
      domainsChecked: s.domainStatusCounts.reduce((sum, r) => sum + r.count, 0),
      // Distinct root domains, not a raw row count (the raw guest_post_links
      // rows are gone) — the closest real number archiving kept, same as
      // what the archived summary page itself already shows for this field.
      totalLinks: s.linksCount,
      keptProspects: s.contactStats.kept,
    };
  });
  const liveRows: CachedCountsRow[] = uncachedLive.map((c) => ({
    id: c.id,
    totalDomains: freshInactiveMaps.domainMap.get(c.id) ?? 0,
    domainsChecked: freshInactiveMaps.statusMap.get(c.id) ?? 0,
    totalLinks: freshInactiveMaps.linkMap.get(c.id) ?? 0,
    keptProspects: freshInactiveMaps.keptMap.get(c.id) ?? 0,
  }));
  if (archivedRows.length + liveRows.length > 0) {
    // Not awaited — this response already has the numbers it needs below;
    // writing them back is purely so the NEXT load is free, nothing this
    // request itself needs to wait on.
    persistCachedCounts([...archivedRows, ...liveRows]).catch((err) =>
      console.error("[listCampaigns] failed to persist cached counts:", err)
    );
  }
  const archivedById = new Map(archivedRows.map((r) => [r.id, r]));
  const lookup = (map: keyof CountMaps, id: string) => activeMaps[map].get(id) ?? freshInactiveMaps[map].get(id) ?? 0;

  return allCampaigns.map((c) => {
    if (!isCampaignActive(c)) {
      // Already cached (the common case, after the first load following
      // this change): straight off the row, zero extra computation.
      if (c.cachedTotalDomains !== null) {
        return {
          ...c,
          totalDomains: c.cachedTotalDomains,
          domainsChecked: c.cachedDomainsChecked ?? 0,
          totalLinks: c.cachedTotalLinks ?? 0,
          keptProspects: c.cachedKeptProspects ?? 0,
        };
      }
      const archived = archivedById.get(c.id);
      if (archived) {
        return { ...c, totalDomains: archived.totalDomains, domainsChecked: archived.domainsChecked, totalLinks: archived.totalLinks, keptProspects: archived.keptProspects };
      }
    }
    return {
      ...c,
      totalDomains: lookup("domainMap", c.id),
      domainsChecked: lookup("statusMap", c.id),
      totalLinks: lookup("linkMap", c.id),
      keptProspects: lookup("keptMap", c.id),
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 1: domain status — breakdown counts (unbounded, but just a handful of
// grouped rows) kept separate from the actual row page (always bounded).
// ---------------------------------------------------------------------------

async function queryDomainStatusCounts(id: string) {
  return db
    .select({ status: domainCrawlStatus.status, count: sql<number>`count(*)::int` })
    .from(domainCrawlStatus)
    .where(eq(domainCrawlStatus.campaignId, id))
    .groupBy(domainCrawlStatus.status);
}

export async function getCampaignDomainStatusesPage(id: string, opts: { page?: number; status?: string; search?: string } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const conditions = [eq(domainCrawlStatus.campaignId, id)];
  if (opts.status) {
    conditions.push(eq(domainCrawlStatus.status, opts.status as (typeof domainCrawlStatus.$inferSelect)["status"]));
  }
  if (opts.search) conditions.push(ilike(domainCrawlStatus.domain, `%${opts.search}%`));
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(domainCrawlStatus)
      .where(where)
      .orderBy(desc(domainCrawlStatus.checkedAt))
      .limit(ROWS_PAGE_SIZE)
      .offset((page - 1) * ROWS_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(domainCrawlStatus).where(where),
  ]);
  return { rows, total, pageCount: Math.max(1, Math.ceil(total / ROWS_PAGE_SIZE)) };
}

// ---------------------------------------------------------------------------
// Stage 2/3: prospects — same split, plus the aggregate stats the contact
// dashboard needs, computed in SQL instead of by scanning every row in JS.
// ---------------------------------------------------------------------------

async function queryProspectReasonCounts(id: string) {
  return db
    .select({ reason: guestPostProspects.exclusionReason, count: sql<number>`count(*)::int` })
    .from(guestPostProspects)
    .where(eq(guestPostProspects.campaignId, id))
    .groupBy(guestPostProspects.exclusionReason);
}

const CONTACT_FILTER_KEYS = ["has_email", "has_form", "both", "form_only", "none", "blocked", "failed", "pending"] as const;
export type ContactFilterKey = (typeof CONTACT_FILTER_KEYS)[number];

function contactFilterCondition(key: string) {
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
    default:
      return undefined;
  }
}

// Everything the campaign detail page + Contact Results page need, computed
// together in 3 queries total (was up to 16 separate ones across the 5
// functions this replaced) using count(*) filter (where ...) instead of one
// round trip per condition — same answers, far fewer queries. Never called
// directly by a page; see getCampaignDetailStats below for the caching that
// decides WHEN this actually needs to run.
async function computeDetailStats(id: string): Promise<CachedDetailStats> {
  const kept = and(eq(guestPostProspects.campaignId, id), isNull(guestPostProspects.exclusionReason));

  const [domainStatusCounts, prospectReasonCounts, [{ linksCount }], [{ totalDomains }], [statsRow], [filterRow], blockedRows] =
    await Promise.all([
      queryDomainStatusCounts(id),
      queryProspectReasonCounts(id),
      db.select({ linksCount: sql<number>`count(distinct ${guestPostLinks.rootDomain})::int` }).from(guestPostLinks).where(eq(guestPostLinks.campaignId, id)),
      db.select({ totalDomains: sql<number>`count(*)::int` }).from(campaignDomains).where(eq(campaignDomains.campaignId, id)),
      db
        .select({
          kept: sql<number>`count(*)::int`,
          looked: sql<number>`count(*) filter (where ${isNotNull(guestPostProspects.contactCheckedAt)})::int`,
          reached: sql<number>`count(*) filter (where ${or(isNotNull(guestPostProspects.emailAddress), isNotNull(guestPostProspects.contactFormUrl))})::int`,
          formsConfirmed: sql<number>`count(*) filter (where ${isNotNull(guestPostProspects.contactFormUrl)} and ${guestPostProspects.contactReason} ~* 'contact form confirmed')::int`,
          // The ProportionBar's "has email" segment specifically means
          // contact_status = 'has_email' (the primary outcome label),
          // distinct from "email present" used by the filter chips — a
          // prospect can carry an email address alongside a different
          // primary status.
          hasEmailStatus: sql<number>`count(*) filter (where ${eq(guestPostProspects.contactStatus, "has_email")})::int`,
          totalEmails: sql<number>`coalesce(sum(case when ${guestPostProspects.emailAddress} is not null then array_length(string_to_array(${guestPostProspects.emailAddress}, ','), 1) else 0 end), 0)::int`,
          retryableCount: sql<number>`count(*) filter (where ${inArray(guestPostProspects.contactStatus, ["blocked", "timeout", "dns_error", "error"])})::int`,
        })
        .from(guestPostProspects)
        .where(kept),
      db
        .select(
          Object.fromEntries(CONTACT_FILTER_KEYS.map((k) => [k, sql<number>`count(*) filter (where ${contactFilterCondition(k)})::int`])) as Record<
            ContactFilterKey,
            ReturnType<typeof sql<number>>
          >
        )
        .from(guestPostProspects)
        .where(kept),
      // Blocked leads' raw reason text — bounded on its own (a small subset
      // of the campaign), fetched separately since it's actual rows, not
      // something a count() can produce.
      db
        .select({ contactReason: guestPostProspects.contactReason })
        .from(guestPostProspects)
        .where(and(eq(guestPostProspects.campaignId, id), isNull(guestPostProspects.exclusionReason), eq(guestPostProspects.contactStatus, "blocked"))),
    ]);

  return {
    totalDomains,
    linksCount,
    domainStatusCounts,
    prospectReasonCounts,
    retryableCount: statsRow.retryableCount,
    contactStats: {
      kept: statsRow.kept,
      looked: statsRow.looked,
      reached: statsRow.reached,
      formsConfirmed: statsRow.formsConfirmed,
      totalEmails: statsRow.totalEmails,
      hasEmailStatus: statsRow.hasEmailStatus,
    },
    contactFilterCounts: filterRow as Record<ContactFilterKey, number>,
    blockedReasons: blockedRows.map((r) => r.contactReason),
  };
}

// Short in-memory cache for the ONE currently-active campaign (same pattern
// and same 60s ceiling as ACTIVE_COUNTS_CACHE_MS above — "up to a minute
// stale is fine, speed is what matters" was the explicit call here).
const ACTIVE_DETAIL_STATS_CACHE_MS = 60_000;
const activeDetailStatsCache = new Map<string, { at: number; data: CachedDetailStats }>();
const activeDetailStatsRefreshing = new Map<string, Promise<void>>();

// The single entry point the campaign detail page + Contact Results page
// both call. Three cases: (1) the active campaign — short in-memory cache,
// refreshed in the background at most once a minute; (2) an inactive
// campaign whose stats are already frozen on its own row — read directly,
// zero query; (3) an inactive campaign going through this for the first
// time — compute once, persist, never recompute. (Archived campaigns never
// reach here: both pages redirect to the frozen archivedSummary view before
// calling this.)
export async function getCampaignDetailStats(campaign: typeof campaigns.$inferSelect): Promise<CachedDetailStats> {
  if (isCampaignActive(campaign)) {
    const cached = activeDetailStatsCache.get(campaign.id);
    if (!cached) {
      const data = await computeDetailStats(campaign.id);
      activeDetailStatsCache.set(campaign.id, { at: Date.now(), data });
      return data;
    }
    if (Date.now() - cached.at >= ACTIVE_DETAIL_STATS_CACHE_MS && !activeDetailStatsRefreshing.has(campaign.id)) {
      const p = computeDetailStats(campaign.id)
        .then((data) => {
          activeDetailStatsCache.set(campaign.id, { at: Date.now(), data });
        })
        .catch((err) => console.error(`[detail stats] refresh failed for ${campaign.id}:`, err))
        .finally(() => activeDetailStatsRefreshing.delete(campaign.id));
      activeDetailStatsRefreshing.set(campaign.id, p);
    }
    return cached.data;
  }

  if (campaign.cachedDetailStats) return campaign.cachedDetailStats;

  const data = await computeDetailStats(campaign.id);
  db.update(campaigns)
    .set({ cachedDetailStats: data })
    .where(eq(campaigns.id, campaign.id))
    .catch((err) => console.error(`[detail stats] failed to persist for ${campaign.id}:`, err));
  return data;
}

export async function getCampaignProspectsPage(
  id: string,
  opts: { page?: number; reason?: string; contact?: string; search?: string } = {}
) {
  const page = Math.max(1, opts.page ?? 1);
  const conditions = [eq(guestPostProspects.campaignId, id)];
  if (opts.reason) {
    conditions.push(
      opts.reason === "kept" ? isNull(guestPostProspects.exclusionReason) : eq(guestPostProspects.exclusionReason, opts.reason)
    );
  }
  if (opts.contact) {
    conditions.push(isNull(guestPostProspects.exclusionReason));
    const c = contactFilterCondition(opts.contact);
    if (c) conditions.push(c);
  }
  if (opts.search) conditions.push(ilike(guestPostProspects.rootDomain, `%${opts.search}%`));
  const where = and(...conditions);

  // Bounded to one page (≤50 rows), so a left join for the claiming campaign's
  // name/owner is cheap here — no need for the full export's separate lookup.
  const claimerCampaigns = alias(campaigns, "claimer_campaigns");
  const claimerProfiles = alias(profiles, "claimer_profiles");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        ...getTableColumns(guestPostProspects),
        claimedByCampaignName: claimerCampaigns.name,
        claimedByOwnerEmail: claimerProfiles.email,
      })
      .from(guestPostProspects)
      .leftJoin(claimerCampaigns, eq(guestPostProspects.claimedByCampaignId, claimerCampaigns.id))
      .leftJoin(claimerProfiles, eq(claimerCampaigns.createdBy, claimerProfiles.id))
      .where(where)
      .orderBy(desc(guestPostProspects.createdAt))
      .limit(ROWS_PAGE_SIZE)
      .offset((page - 1) * ROWS_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(guestPostProspects).where(where),
  ]);
  return { rows, total, pageCount: Math.max(1, Math.ceil(total / ROWS_PAGE_SIZE)) };
}

// ---------------------------------------------------------------------------
// The live campaign page — everything here is either bounded to one page of
// rows or a lightweight aggregate. Nothing here scales with campaign size.
// ---------------------------------------------------------------------------

export async function getCampaignDetail(id: string, opts: { domainPage?: number; domainStatus?: string; domainSearch?: string } = {}) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;

  const [domainStatusesPage, stats] = await Promise.all([
    getCampaignDomainStatusesPage(id, { page: opts.domainPage, status: opts.domainStatus, search: opts.domainSearch }),
    getCampaignDetailStats(campaign),
  ]);

  return {
    campaign,
    domainStatuses: domainStatusesPage.rows,
    domainStatusesTotal: domainStatusesPage.total,
    domainStatusesPageCount: domainStatusesPage.pageCount,
    domainStatusCounts: stats.domainStatusCounts,
    linksCount: stats.linksCount,
    totalDomains: stats.totalDomains,
    prospectReasonCounts: stats.prospectReasonCounts,
    retryableCount: stats.retryableCount,
  };
}

// The export route's own fetch — it genuinely needs every raw row (to build
// "one row per input domain"), unlike the live page above. This only runs
// once per explicit export click, never on a timer or a poll, so an
// unpaginated fetch here isn't the problem the page's polling was.
export async function getCampaignExportData(id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;

  const [domainStatuses, links, prospects, domainRows] = await Promise.all([
    db.select().from(domainCrawlStatus).where(eq(domainCrawlStatus.campaignId, id)).orderBy(desc(domainCrawlStatus.checkedAt)),
    db.select().from(guestPostLinks).where(eq(guestPostLinks.campaignId, id)).orderBy(desc(guestPostLinks.dateFound)),
    db.select().from(guestPostProspects).where(eq(guestPostProspects.campaignId, id)).orderBy(desc(guestPostProspects.createdAt)),
    db.select({ domain: campaignDomains.domain }).from(campaignDomains).where(eq(campaignDomains.campaignId, id)),
  ]);

  const domains = domainRows.map((r) => r.domain).sort();

  // Who actually holds a "claimed_by_teammate" exclusion — one extra lookup,
  // only for the (usually small) set of campaigns that show up as a claimer,
  // not one query per prospect row.
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
    return {
      ...p,
      claimedByCampaignName: claimer?.name ?? null,
      claimedByOwnerEmail: claimer?.ownerEmail ?? null,
    };
  });

  return { campaign, domainStatuses, links, prospects: prospectsWithClaimer, domains, totalDomains: domains.length };
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
        eq(campaigns.contactStageStatus, "not_started"),
        isNull(campaigns.archivedAt)
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

// Every related row (campaign_domains, domain_crawl_status, guest_post_links,
// guest_post_prospects) cascades automatically at the DB level — deleting the
// campaign is enough, nothing else needs cleaning up by hand. That also means
// dedup is unaffected going forward: a domain this campaign had claimed is
// gone the moment its prospect row is gone, so it's immediately free again
// for any other campaign, exactly as if this one had never run.
//
// Paused first so a still-running worker stops at its next check-in instead
// of trying to write a result for a campaign that no longer exists — mostly
// cosmetic (that write would just fail on the foreign key, not corrupt
// anything), but avoids noisy errors in the worker's logs.
export async function deleteCampaign(campaignId: string) {
  await db.update(campaigns).set({ paused: true }).where(eq(campaigns.id, campaignId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
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
  if (c.archivedAt) {
    return { ok: false, error: "This campaign's detailed data was cleaned up a week after it completed — nothing left to retry." };
  }
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

// ---------------------------------------------------------------------------
// Puts every "no posts found" domain of a FINISHED campaign back up for
// re-crawl and queues the campaign again. Stage 1 (runCampaign.ts) only ever
// processes domains with NO row in domain_crawl_status yet — deleting just
// these rows is what makes it pick exactly these domains back up, while
// every already-checked domain (success, blocked, error, etc.) is left
// alone and correctly skipped. Re-running then naturally goes through the
// same filter/dedup stage and, if the campaign has auto-contact on, straight
// into contact lookup too — the normal end-of-crawl flow, just re-triggered.
export async function retryNoPostsFound(campaignId: string): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return { ok: false, error: "Campaign not found" };
  if (c.archivedAt) {
    return { ok: false, error: "This campaign's detailed data was cleaned up a week after it completed — nothing left to retry." };
  }
  if (c.status !== "completed") {
    return { ok: false, error: "Wait for the campaign to finish before retrying." };
  }

  const deleted = await db
    .delete(domainCrawlStatus)
    .where(and(eq(domainCrawlStatus.campaignId, campaignId), eq(domainCrawlStatus.status, "no_posts_found")))
    .returning({ domain: domainCrawlStatus.domain });
  if (deleted.length === 0) return { ok: false, error: "Nothing to retry." };

  await db.update(campaigns).set({ status: "queued", paused: false }).where(eq(campaigns.id, campaignId));
  return { ok: true, queued: deleted.length };
}

// ---------------------------------------------------------------------------
// For a monitor/incremental campaign started with the wrong settings (wrong
// days window, wrong domain list) — lets the operator restart it as a true
// from-scratch crawl instead of manually clearing DB rows. Flips `incremental`
// off so the worker stops consulting processed_posts for every domain still
// to come, and clears this campaign's own domain_crawl_status so domains it
// already finished (with stale pre-correction settings) get re-checked too.
//
// Deliberately does NOT touch processed_posts itself — that table is shared
// across every campaign that has ever monitored a domain, keyed only by post
// URL, not campaign. Deleting rows from it here would also erase dedup
// history for other, unrelated campaigns relying on it (see 2026-10-27
// incident: this is a scoped, no-side-effect replacement for doing that by
// hand).
export async function forceFreshRecrawl(campaignId: string): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return { ok: false, error: "Campaign not found" };
  if (c.archivedAt) {
    return { ok: false, error: "This campaign's detailed data was cleaned up a week after it completed — nothing left to restart." };
  }
  if (!c.incremental) {
    return { ok: false, error: "This campaign isn't using prior-run history, so there's nothing to ignore — it already crawls fresh." };
  }

  const deleted = await db.delete(domainCrawlStatus).where(eq(domainCrawlStatus.campaignId, campaignId)).returning({ domain: domainCrawlStatus.domain });

  await db.update(campaigns).set({ incremental: false, status: "queued", paused: false }).where(eq(campaigns.id, campaignId));
  return { ok: true, queued: deleted.length };
}

// Estimated finish time. The maths lives in lib/campaignEta.ts (documented in
// docs/CAMPAIGN_ETA.md); this gathers its inputs. Every query is an aggregate
// that returns a few numbers per campaign, never rows, and is only run for
// campaigns that are actually active.
// ---------------------------------------------------------------------------

type CampaignRow = typeof campaigns.$inferSelect;

// Pages can be opened by several people and reloaded often; the answer only
// moves slowly, so don't re-run the aggregates more than every 30s per campaign.
const ETA_CACHE_MS = 30_000;
const etaCache = new Map<string, { at: number; eta: CampaignEta }>();

// Past campaigns' contact-lookup speed (lookups/minute), used to price the
// contact stage before this campaign has run it. Moves very slowly: 10 min cache.
let historicalRate: { at: number; value: number | null } | null = null;

async function getHistoricalContactRate(): Promise<number | null> {
  if (historicalRate && Date.now() - historicalRate.at < 10 * 60_000) return historicalRate.value;
  // Per campaign: lookups done and the time between its first and last one.
  // Needs 50+ lookups, or the span says nothing. Pauses inside the span make it
  // read slightly slower than reality, which errs on the safe side.
  const per = db
    .select({
      n: sql<number>`count(*)`.as("n"),
      secs: sql<number>`extract(epoch from max(${guestPostProspects.contactCheckedAt}) - min(${guestPostProspects.contactCheckedAt}))`.as("secs"),
    })
    .from(guestPostProspects)
    .where(gt(guestPostProspects.contactCheckedAt, sql`now() - interval '30 days'`))
    .groupBy(guestPostProspects.campaignId)
    .having(sql`count(*) >= 50`)
    .as("per");
  const [r] = await db
    .select({
      n: sql<number>`coalesce(sum(${per.n}), 0)::float8`,
      secs: sql<number>`coalesce(sum(${per.secs}), 0)::float8`,
    })
    .from(per)
    .where(sql`${per.secs} > 0`);
  const value = r && r.secs > 0 ? r.n / (r.secs / 60) : null;
  historicalRate = { at: Date.now(), value };
  return value;
}

export async function getCampaignEtas(rows: CampaignRow[]): Promise<Map<string, CampaignEta>> {
  const result = new Map<string, CampaignEta>();
  const now = new Date();
  const active = rows.filter(
    (c) => c.status === "queued" || c.status === "running" || c.contactStageStatus === "queued" || c.contactStageStatus === "running"
  );
  for (const c of rows) if (!active.includes(c)) result.set(c.id, { kind: "none" });

  const stale = active.filter((c) => {
    const hit = etaCache.get(c.id);
    if (hit && now.getTime() - hit.at < ETA_CACHE_MS) {
      result.set(c.id, hit.eta);
      return false;
    }
    return true;
  });
  if (stale.length === 0) return result;

  const ids = stale.map((c) => c.id);
  const crawlingIds = stale
    .filter((c) => c.mode === "discovery" && c.autoContact && c.contactStageStatus === "not_started")
    .map((c) => c.id);

  const since = (minutes: number, col: typeof domainCrawlStatus.checkedAt | typeof guestPostProspects.contactCheckedAt) =>
    sql<number>`count(*) filter (where ${col} > now() - make_interval(mins => ${minutes}))::int`;

  const [domainTotals, crawlChecked, crawlEvents, contactRows, backlinkRows, historical] = await Promise.all([
    db
      .select({ campaignId: campaignDomains.campaignId, count: sql<number>`count(*)::int` })
      .from(campaignDomains)
      .where(inArray(campaignDomains.campaignId, ids))
      .groupBy(campaignDomains.campaignId),
    db
      .select({ campaignId: domainCrawlStatus.campaignId, count: sql<number>`count(*)::int` })
      .from(domainCrawlStatus)
      .where(inArray(domainCrawlStatus.campaignId, ids))
      .groupBy(domainCrawlStatus.campaignId),
    db
      .select({
        campaignId: domainCrawlStatus.campaignId,
        m5: since(5, domainCrawlStatus.checkedAt),
        m15: since(15, domainCrawlStatus.checkedAt),
        m60: since(60, domainCrawlStatus.checkedAt),
      })
      .from(domainCrawlStatus)
      .where(and(inArray(domainCrawlStatus.campaignId, ids), gt(domainCrawlStatus.checkedAt, sql`now() - interval '60 minutes'`)))
      .groupBy(domainCrawlStatus.campaignId),
    db
      .select({
        campaignId: guestPostProspects.campaignId,
        keptPending: sql<number>`count(*) filter (where ${guestPostProspects.exclusionReason} is null and ${guestPostProspects.contactCheckedAt} is null)::int`,
        m5: since(5, guestPostProspects.contactCheckedAt),
        m15: since(15, guestPostProspects.contactCheckedAt),
        m60: since(60, guestPostProspects.contactCheckedAt),
      })
      .from(guestPostProspects)
      .where(inArray(guestPostProspects.campaignId, ids))
      .groupBy(guestPostProspects.campaignId),
    crawlingIds.length
      ? db
          .select({ campaignId: guestPostLinks.campaignId, count: sql<number>`count(distinct ${guestPostLinks.rootDomain})::int` })
          .from(guestPostLinks)
          .where(inArray(guestPostLinks.campaignId, crawlingIds))
          .groupBy(guestPostLinks.campaignId)
      : Promise.resolve([] as { campaignId: string; count: number }[]),
    getHistoricalContactRate(),
  ]);

  const totals = new Map(domainTotals.map((r) => [r.campaignId, r.count]));
  const checked = new Map(crawlChecked.map((r) => [r.campaignId, r.count]));
  const crawlEv = new Map(crawlEvents.map((r) => [r.campaignId, { m5: r.m5, m15: r.m15, m60: r.m60 }]));
  const contactMap = new Map(contactRows.map((r) => [r.campaignId, r]));
  const backlinks = new Map(backlinkRows.map((r) => [r.campaignId, r.count]));
  const none: Events = { m5: 0, m15: 0, m60: 0 };

  for (const c of stale) {
    const contact = contactMap.get(c.id);
    const eta = computeCampaignEta({
      mode: c.mode,
      status: c.status,
      contactStageStatus: c.contactStageStatus,
      paused: c.paused,
      autoContact: c.autoContact,
      startedAt: c.startedAt,
      contactStageStartedAt: c.contactStageStartedAt,
      totalDomains: totals.get(c.id) ?? 0,
      domainsChecked: checked.get(c.id) ?? 0,
      crawlEvents: crawlEv.get(c.id) ?? none,
      distinctBacklinkDomains: backlinks.get(c.id) ?? 0,
      keptPending: contact?.keptPending ?? 0,
      contactEvents: contact ? { m5: contact.m5, m15: contact.m15, m60: contact.m60 } : none,
      historicalContactRate: historical,
      now,
    });
    etaCache.set(c.id, { at: now.getTime(), eta });
    result.set(c.id, eta);
  }
  return result;
}

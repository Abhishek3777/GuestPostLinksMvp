import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, getTableColumns, gt, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { computeCampaignEta, type CampaignEta, type Events } from "@/lib/campaignEta";
import { campaignDomains, campaigns, domainCrawlStatus, guestPostLinks, guestPostProspects, profiles } from "@/lib/schema";

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

// undefined userId (admin) = every campaign. Otherwise, only ones they started.
export async function listCampaigns(userId?: string) {
  const allCampaignRows = await db
    .select({ campaign: campaigns, ownerEmail: profiles.email })
    .from(campaigns)
    .leftJoin(profiles, eq(campaigns.createdBy, profiles.id))
    .where(userId ? eq(campaigns.createdBy, userId) : undefined)
    .orderBy(desc(campaigns.createdAt));
  const allCampaigns = allCampaignRows.map((r) => ({ ...r.campaign, ownerEmail: r.ownerEmail }));

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

// ---------------------------------------------------------------------------
// Stage 1: domain status — breakdown counts (unbounded, but just a handful of
// grouped rows) kept separate from the actual row page (always bounded).
// ---------------------------------------------------------------------------

export async function getCampaignDomainStatusCounts(id: string) {
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

export async function getCampaignProspectReasonCounts(id: string) {
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

// Counts for the filter chips — among KEPT prospects only, same as the chips
// themselves only ever apply to kept leads.
export async function getCampaignContactFilterCounts(id: string): Promise<Record<ContactFilterKey, number>> {
  const kept = and(eq(guestPostProspects.campaignId, id), isNull(guestPostProspects.exclusionReason));
  const results = await Promise.all(
    CONTACT_FILTER_KEYS.map((k) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(guestPostProspects)
        .where(and(kept, contactFilterCondition(k)))
    )
  );
  return Object.fromEntries(CONTACT_FILTER_KEYS.map((k, i) => [k, results[i][0].count])) as Record<ContactFilterKey, number>;
}

// The contact dashboard's top-line stats — computed in SQL so it never needs
// the full prospect list just to produce a handful of numbers.
export async function getCampaignContactStats(id: string) {
  const kept = and(eq(guestPostProspects.campaignId, id), isNull(guestPostProspects.exclusionReason));
  const [[{ keptCount }], [{ looked }], [{ reached }], [{ formsConfirmed }], [{ totalEmails }], [{ hasEmailStatus }]] = await Promise.all([
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
    // The ProportionBar's "has email" segment specifically means contact_status
    // = 'has_email' (the primary outcome label), distinct from "email present"
    // used by the filter chips above — a prospect can carry an email address
    // alongside a different primary status.
    db
      .select({ hasEmailStatus: sql<number>`count(*)::int` })
      .from(guestPostProspects)
      .where(and(kept, eq(guestPostProspects.contactStatus, "has_email"))),
  ]);
  return { kept: keptCount, looked, reached, formsConfirmed, totalEmails, hasEmailStatus };
}

// Blocked leads are a small subset of the campaign — bounded on their own,
// fetched just for the "why sites blocked us" breakdown, which genuinely
// needs the raw reason text (not something a COUNT can produce).
export async function getCampaignBlockedReasons(id: string) {
  const rows = await db
    .select({ contactReason: guestPostProspects.contactReason })
    .from(guestPostProspects)
    .where(
      and(
        eq(guestPostProspects.campaignId, id),
        isNull(guestPostProspects.exclusionReason),
        eq(guestPostProspects.contactStatus, "blocked")
      )
    );
  return rows.map((r) => r.contactReason);
}

export async function getCampaignRetryableCount(id: string) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(guestPostProspects)
    .where(
      and(
        eq(guestPostProspects.campaignId, id),
        isNull(guestPostProspects.exclusionReason),
        inArray(guestPostProspects.contactStatus, ["blocked", "timeout", "dns_error", "error"])
      )
    );
  return count;
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

  const [domainStatusesPage, domainStatusCounts, [{ linksCount }], [{ totalDomains }]] = await Promise.all([
    getCampaignDomainStatusesPage(id, { page: opts.domainPage, status: opts.domainStatus, search: opts.domainSearch }),
    getCampaignDomainStatusCounts(id),
    // Unique backlink DOMAINS, not raw link rows — the same domain can show up
    // in many articles, and a sales/marketing reader cares about distinct
    // opportunities, not how many times one was mentioned.
    db
      .select({ linksCount: sql<number>`count(distinct ${guestPostLinks.rootDomain})::int` })
      .from(guestPostLinks)
      .where(eq(guestPostLinks.campaignId, id)),
    db.select({ totalDomains: sql<number>`count(*)::int` }).from(campaignDomains).where(eq(campaignDomains.campaignId, id)),
  ]);

  return {
    campaign,
    domainStatuses: domainStatusesPage.rows,
    domainStatusesTotal: domainStatusesPage.total,
    domainStatusesPageCount: domainStatusesPage.pageCount,
    domainStatusCounts,
    linksCount,
    totalDomains,
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

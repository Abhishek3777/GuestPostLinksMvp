import { and, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, guestPostProspects, profiles } from "@/lib/schema";

// A "lead" is a kept prospect where contact lookup found an email address, a
// contact form, or both. Same definition as the Reached tile on a campaign's
// Contact results page.

const TZ = "Asia/Kolkata";

export type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";

export interface LeadCounts {
  emailOnly: number;
  formOnly: number;
  both: number;
  total: number;
}

export interface LeadCampaign extends LeadCounts {
  id: string;
  name: string;
  ownerId: string | null;
  ownerEmail: string | null;
  // yyyy-mm-dd in IST. Finished campaigns count on the day their contact
  // lookup finished; campaigns still running count on today.
  date: string;
  inProgress: boolean;
}

export interface MemberOption {
  id: string;
  label: string;
}

export interface MemberRow extends LeadCounts {
  id: string | null;
  label: string;
  campaigns: number;
}

export interface DayPoint extends LeadCounts {
  date: string;
}

export interface LeadsReport {
  range: RangeKey;
  from: string;
  to: string;
  userId: string | null;
  members: MemberOption[];
  totals: LeadCounts;
  previous: LeadCounts | null;
  previousLabel: string;
  campaignCount: number;
  days: DayPoint[];
  byMember: MemberRow[];
  rows: LeadCampaign[];
}

const emptyCounts = (): LeadCounts => ({ emailOnly: 0, formOnly: 0, both: 0, total: 0 });

function addInto(target: LeadCounts, c: LeadCounts) {
  target.emailOnly += c.emailOnly;
  target.formOnly += c.formOnly;
  target.both += c.both;
  target.total += c.total;
}

function fromFilterCounts(fc: Record<string, number> | null | undefined): LeadCounts | null {
  if (!fc || typeof fc.has_email !== "number" || typeof fc.has_form !== "number" || typeof fc.both !== "number") return null;
  const emailOnly = fc.has_email - fc.both;
  const formOnly = fc.has_form - fc.both;
  return { emailOnly, formOnly, both: fc.both, total: emailOnly + formOnly + fc.both };
}

export function istDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRange(range: string | undefined, fromParam?: string, toParam?: string) {
  const today = istDate(new Date());
  if (range === "custom" && fromParam && toParam && DATE_RE.test(fromParam) && DATE_RE.test(toParam)) {
    let from = fromParam;
    let to = toParam;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (daysBetween(from, to) > 366) from = shiftDate(to, -365);
    return { range: "custom" as RangeKey, from, to };
  }
  if (range === "today") return { range: "today" as RangeKey, from: today, to: today };
  if (range === "7d") return { range: "7d" as RangeKey, from: shiftDate(today, -6), to: today };
  if (range === "90d") return { range: "90d" as RangeKey, from: shiftDate(today, -89), to: today };
  return { range: "30d" as RangeKey, from: shiftDate(today, -29), to: today };
}

// "Deepika" from deepika.acgdm@gmail.com. Falls back to the full address when
// two people would end up with the same first name.
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const first = local.split(/[._+\-0-9]/).filter(Boolean)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function memberLabels(rows: { id: string; email: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(nameFromEmail(r.email), (counts.get(nameFromEmail(r.email)) ?? 0) + 1);
  return new Map(rows.map((r) => [r.id, (counts.get(nameFromEmail(r.email)) ?? 0) > 1 ? r.email : nameFromEmail(r.email)]));
}

// One small query over the campaigns table, plus one grouped count only for
// campaigns that have no frozen summary yet (running, or finished and never
// opened). Everything else reads numbers that were already computed once.
async function loadLeadCampaigns(): Promise<LeadCampaign[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      ownerId: campaigns.createdBy,
      contactStageStatus: campaigns.contactStageStatus,
      contactStageCompletedAt: campaigns.contactStageCompletedAt,
      frozen: sql<Record<string, number> | null>`coalesce(${campaigns.archivedSummary}->'contactFilterCounts', ${campaigns.cachedDetailStats}->'contactFilterCounts')`,
    })
    .from(campaigns)
    .where(or(isNotNull(campaigns.contactStageCompletedAt), sql`${campaigns.contactStageStatus} = 'running'`));

  const owners = await db.select({ id: profiles.id, email: profiles.email }).from(profiles);
  const emailById = new Map(owners.map((o) => [o.id, o.email]));

  const needLive = rows.filter((r) => r.contactStageStatus === "running" || !fromFilterCounts(r.frozen)).map((r) => r.id);
  const live = new Map<string, LeadCounts>();
  if (needLive.length) {
    const liveRows = await db
      .select({
        campaignId: guestPostProspects.campaignId,
        emailOnly: sql<number>`count(*) filter (where ${isNotNull(guestPostProspects.emailAddress)} and ${isNull(guestPostProspects.contactFormUrl)})::int`,
        formOnly: sql<number>`count(*) filter (where ${isNotNull(guestPostProspects.contactFormUrl)} and ${isNull(guestPostProspects.emailAddress)})::int`,
        both: sql<number>`count(*) filter (where ${isNotNull(guestPostProspects.emailAddress)} and ${isNotNull(guestPostProspects.contactFormUrl)})::int`,
      })
      .from(guestPostProspects)
      .where(and(inArray(guestPostProspects.campaignId, needLive), isNull(guestPostProspects.exclusionReason)))
      .groupBy(guestPostProspects.campaignId);
    for (const l of liveRows) live.set(l.campaignId, { emailOnly: l.emailOnly, formOnly: l.formOnly, both: l.both, total: l.emailOnly + l.formOnly + l.both });
  }

  const today = istDate(new Date());
  const out: LeadCampaign[] = [];
  for (const r of rows) {
    const inProgress = r.contactStageStatus === "running";
    const counts = inProgress ? live.get(r.id) : (fromFilterCounts(r.frozen) ?? live.get(r.id));
    if (!counts) continue;
    const date = inProgress || !r.contactStageCompletedAt ? today : istDate(r.contactStageCompletedAt);
    out.push({
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      ownerEmail: r.ownerId ? (emailById.get(r.ownerId) ?? null) : null,
      date,
      inProgress,
      ...counts,
    });
  }
  return out;
}

// Short memo so flipping filters does not re-read the table every click.
const CACHE_MS = 60_000;
let cache: { at: number; data: Promise<LeadCampaign[]> } | null = null;

function getLeadCampaigns(): Promise<LeadCampaign[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const data = loadLeadCampaigns();
    cache = { at: Date.now(), data };
    data.catch(() => {
      if (cache?.data === data) cache = null;
    });
  }
  return cache.data;
}

export async function getLeadsReport(params: { range?: string; from?: string; to?: string; user?: string }): Promise<LeadsReport> {
  const { range, from, to } = resolveRange(params.range, params.from, params.to);
  const all = await getLeadCampaigns();
  const team = await db.select({ id: profiles.id, email: profiles.email }).from(profiles);
  const labels = memberLabels(team);

  const owningIds = new Set(all.map((c) => c.ownerId));
  const members: MemberOption[] = team
    .filter((t) => owningIds.has(t.id))
    .map((t) => ({ id: t.id, label: labels.get(t.id) ?? t.email }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const userId = params.user && team.some((t) => t.id === params.user) ? params.user : null;

  const scoped = userId ? all.filter((c) => c.ownerId === userId) : all;
  const inRange = scoped.filter((c) => c.date >= from && c.date <= to);

  const totals = emptyCounts();
  for (const c of inRange) addInto(totals, c);

  const length = daysBetween(from, to);
  const prevTo = shiftDate(from, -1);
  const prevFrom = shiftDate(prevTo, -(length - 1));
  const prevRows = scoped.filter((c) => c.date >= prevFrom && c.date <= prevTo);
  const previous = prevRows.length ? prevRows.reduce((acc, c) => (addInto(acc, c), acc), emptyCounts()) : null;

  const byDate = new Map<string, LeadCounts>();
  for (const c of inRange) {
    const cur = byDate.get(c.date) ?? emptyCounts();
    addInto(cur, c);
    byDate.set(c.date, cur);
  }
  const days: DayPoint[] = [];
  for (let i = 0; i < length; i++) {
    const date = shiftDate(from, i);
    days.push({ date, ...(byDate.get(date) ?? emptyCounts()) });
  }

  const byOwner = new Map<string | null, MemberRow>();
  for (const c of inRange) {
    const row = byOwner.get(c.ownerId) ?? { id: c.ownerId, label: c.ownerId ? (labels.get(c.ownerId) ?? c.ownerEmail ?? "Unknown") : "Unassigned", campaigns: 0, ...emptyCounts() };
    row.campaigns += 1;
    addInto(row, c);
    byOwner.set(c.ownerId, row);
  }

  const rows = [...inRange].sort((a, b) => (a.date === b.date ? b.total - a.total : a.date < b.date ? 1 : -1));

  return {
    range,
    from,
    to,
    userId,
    members,
    totals,
    previous,
    previousLabel: range === "today" ? "yesterday" : `the previous ${length} days`,
    campaignCount: inRange.length,
    days,
    byMember: [...byOwner.values()].sort((a, b) => b.total - a.total),
    rows,
  };
}

import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, type Executor } from "./client.js";
import { appSettings, doNotContact, guestPostLinks, guestPostProspects } from "./schema.js";

export async function loadDoNotContactSet(): Promise<Set<string>> {
  const rows = await db.select({ domain: doNotContact.domain }).from(doNotContact);
  return new Set(rows.map((r) => r.domain));
}

export async function addDoNotContact(domains: string[]) {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return;
  await db
    .insert(doNotContact)
    .values(unique.map((domain) => ({ domain })))
    .onConflictDoNothing();
}

export async function getCampaignLinks(campaignId: string) {
  return db.select().from(guestPostLinks).where(eq(guestPostLinks.campaignId, campaignId)).orderBy(guestPostLinks.dateFound);
}

// Root domains an EARLIER campaign already delivered as a kept lead with a
// definitive contact result (an email, a form, or a real "nothing there"). A
// monitoring run marks these instead of handing them over again. A result that
// only failed for a temporary reason (blocked, timeout, DNS, error, never
// checked) is deliberately not counted, so those get another try. Results
// older than the window are stale and count as new again.
export const ALREADY_FOUND_WINDOW_DAYS = 180;

export async function findAlreadyFoundDomains(campaignId: string, domains: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < domains.length; i += 5000) {
    const rows = await db
      .selectDistinct({ rootDomain: guestPostProspects.rootDomain })
      .from(guestPostProspects)
      .where(
        and(
          ne(guestPostProspects.campaignId, campaignId),
          isNull(guestPostProspects.exclusionReason),
          inArray(guestPostProspects.contactStatus, ["has_email", "form_only", "no_contact_found"]),
          gt(guestPostProspects.contactCheckedAt, sql`now() - make_interval(days => ${ALREADY_FOUND_WINDOW_DAYS})`),
          inArray(guestPostProspects.rootDomain, domains.slice(i, i + 5000))
        )
      );
    for (const r of rows) found.add(r.rootDomain);
  }
  return found;
}

// The app-wide re-contact cooldown (app_settings is a single row, id 1).
// Falls back to 90 if the row is somehow missing rather than erroring out —
// matches the field's own DB default, so a missing row behaves the same as
// a freshly-migrated one.
const DEFAULT_DEDUP_DAYS = 90;

export async function getDedupDays(): Promise<number> {
  const [row] = await db.select({ dedupDays: appSettings.dedupDays }).from(appSettings).where(eq(appSettings.id, 1));
  return row?.dedupDays ?? DEFAULT_DEDUP_DAYS;
}

// Domains ANY OTHER campaign (anyone, any group) has already kept (not
// excluded) as a prospect, within the app-wide cooldown window — regardless
// of whether contact lookup has even run on it yet: being kept is exactly
// what makes a domain show up in an export, and once it's out the door (fed
// into FormBlast, etc.) re-finding it and reaching out again reads as spam
// and risks sender reputation. First campaign to reach this stage claims the
// domain; every other campaign, this run or any later one within the
// window, excludes it instead. Once the window passes, it's fair game
// again. See the note on guestPostProspects in schema.ts.
// Returns WHEN each claimed domain was claimed (the claiming row's
// createdAt), not just whether it was — so callers can say "claimed 31 days
// ago" instead of a bare label. If a domain has more than one qualifying
// claim (edge case), the most recent one wins, since that's the one that
// actually determines when the cooldown ends.
//
// `executor` defaults to the shared db client, but filterAndSave passes in a
// LOCKED transaction here once campaigns can run concurrently — see the
// pg_advisory_xact_lock in filter/index.ts for why this specific read must
// happen inside the same lock as the write in saveProspects below.
export interface ClaimedBy {
  claimedAt: Date;
  campaignId: string;
}

export async function findClaimedGlobally(
  campaignId: string,
  domains: string[],
  dedupDays: number,
  executor: Executor = db
): Promise<Map<string, ClaimedBy>> {
  const claimed = new Map<string, ClaimedBy>();
  if (domains.length === 0) return claimed;

  for (let i = 0; i < domains.length; i += 5000) {
    // DISTINCT ON instead of the old GROUP BY + max(): we need the campaign_id
    // that belongs to that latest claim, not just the timestamp, so the row
    // itself has to come along rather than being aggregated away.
    const rows = await executor.execute<{ root_domain: string; created_at: string; campaign_id: string }>(sql`
      select distinct on (${guestPostProspects.rootDomain}) ${guestPostProspects.rootDomain} as root_domain,
        ${guestPostProspects.createdAt} as created_at, ${guestPostProspects.campaignId} as campaign_id
      from ${guestPostProspects}
      where ${guestPostProspects.campaignId} != ${campaignId}
        and ${guestPostProspects.exclusionReason} is null
        and ${guestPostProspects.createdAt} > now() - make_interval(days => ${dedupDays})
        and ${guestPostProspects.rootDomain} = any(${domains.slice(i, i + 5000)})
      order by ${guestPostProspects.rootDomain}, ${guestPostProspects.createdAt} desc
    `);
    for (const r of rows) claimed.set(r.root_domain, { claimedAt: new Date(r.created_at), campaignId: r.campaign_id });
  }
  return claimed;
}

export interface ProspectInput {
  rootDomain: string;
  exampleGuestPostUrl: string | null;
  exampleExternalLink: string | null;
  exclusionReason: string | null;
  claimedAt?: Date | null;
  claimedByCampaignId?: string | null;
}

export async function saveProspects(campaignId: string, prospects: ProspectInput[], executor: Executor = db) {
  if (!prospects.length) return;
  // Batched: one INSERT caps at ~65k bound parameters, and this row shape binds
  // 6 columns each — a large discovery campaign's unique backlink count can
  // exceed that ceiling well before it exceeds the input-domain count itself.
  for (let i = 0; i < prospects.length; i += 5000) {
    await executor
      .insert(guestPostProspects)
      .values(prospects.slice(i, i + 5000).map((p) => ({ campaignId, ...p })))
      .onConflictDoNothing(); // re-running the filter for the same campaign is a no-op
  }
}

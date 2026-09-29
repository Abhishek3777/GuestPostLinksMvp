import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "./client.js";
import { campaigns, doNotContact, groups, guestPostLinks, guestPostProspects, profiles } from "./schema.js";

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

// Domains a CURRENT group-mate's campaign has already kept (not excluded) as
// a prospect, within that group's own configured cooldown window —
// regardless of whether contact lookup has even run on it yet: being kept is
// exactly what makes a domain show up in an export, and once it's out the
// door (fed into FormBlast, etc.) re-finding it and reaching out again reads
// as spam and risks sender reputation. First campaign to reach this stage
// claims the domain; every other group-mate's campaign, this run or any
// later one within the window, excludes it instead. Once the window passes,
// it's fair game again. Members with no group (or the whole campaign's owner
// having no group) never dedupe against anyone this way — see the note on
// guestPostProspects in schema.ts.
// Returns WHEN each claimed domain was claimed (the claiming row's
// createdAt), not just whether it was — so callers can say "claimed 31 days
// ago" instead of a bare label. If a domain has more than one qualifying
// claim (edge case), the most recent one wins, since that's the one that
// actually determines when the cooldown ends.
export async function findClaimedByGroupmates(campaignId: string, domains: string[]): Promise<Map<string, Date>> {
  const claimed = new Map<string, Date>();
  if (domains.length === 0) return claimed;

  const [owner] = await db
    .select({ groupId: profiles.groupId, dedupDays: groups.dedupDays })
    .from(campaigns)
    .innerJoin(profiles, eq(profiles.id, campaigns.createdBy))
    .innerJoin(groups, eq(groups.id, profiles.groupId))
    .where(eq(campaigns.id, campaignId));
  if (!owner?.groupId) return claimed;

  for (let i = 0; i < domains.length; i += 5000) {
    const rows = await db
      .select({ rootDomain: guestPostProspects.rootDomain, claimedAt: sql<string>`max(${guestPostProspects.createdAt})` })
      .from(guestPostProspects)
      .innerJoin(campaigns, eq(campaigns.id, guestPostProspects.campaignId))
      .innerJoin(profiles, eq(profiles.id, campaigns.createdBy))
      .where(
        and(
          eq(profiles.groupId, owner.groupId),
          ne(guestPostProspects.campaignId, campaignId),
          isNull(guestPostProspects.exclusionReason),
          gt(guestPostProspects.createdAt, sql`now() - make_interval(days => ${owner.dedupDays})`),
          inArray(guestPostProspects.rootDomain, domains.slice(i, i + 5000))
        )
      )
      .groupBy(guestPostProspects.rootDomain);
    for (const r of rows) claimed.set(r.rootDomain, new Date(r.claimedAt));
  }
  return claimed;
}

export interface ProspectInput {
  rootDomain: string;
  exampleGuestPostUrl: string | null;
  exampleExternalLink: string | null;
  exclusionReason: string | null;
  claimedAt?: Date | null;
}

export async function saveProspects(campaignId: string, prospects: ProspectInput[]) {
  if (!prospects.length) return;
  await db
    .insert(guestPostProspects)
    .values(prospects.map((p) => ({ campaignId, ...p })))
    .onConflictDoNothing(); // re-running the filter for the same campaign is a no-op
}

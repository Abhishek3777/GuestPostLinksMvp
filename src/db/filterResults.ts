import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "./client.js";
import { campaigns, doNotContact, guestPostLinks, guestPostProspects, profiles } from "./schema.js";

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
// a prospect — regardless of whether contact lookup has even run on it yet.
// First campaign to reach this stage claims the domain; every other
// group-mate's campaign, this run or any later one, excludes it instead.
// Members with no group (or the whole campaign's owner having no group) never
// dedupe against anyone this way — see the note on guestPostProspects in
// schema.ts.
export async function findClaimedByGroupmates(campaignId: string, domains: string[]): Promise<Set<string>> {
  if (domains.length === 0) return new Set();

  const [owner] = await db
    .select({ groupId: profiles.groupId })
    .from(campaigns)
    .innerJoin(profiles, eq(profiles.id, campaigns.createdBy))
    .where(eq(campaigns.id, campaignId));
  if (!owner?.groupId) return new Set();

  const claimed = new Set<string>();
  for (let i = 0; i < domains.length; i += 5000) {
    const rows = await db
      .selectDistinct({ rootDomain: guestPostProspects.rootDomain })
      .from(guestPostProspects)
      .innerJoin(campaigns, eq(campaigns.id, guestPostProspects.campaignId))
      .innerJoin(profiles, eq(profiles.id, campaigns.createdBy))
      .where(
        and(
          eq(profiles.groupId, owner.groupId),
          ne(guestPostProspects.campaignId, campaignId),
          isNull(guestPostProspects.exclusionReason),
          inArray(guestPostProspects.rootDomain, domains.slice(i, i + 5000))
        )
      );
    for (const r of rows) claimed.add(r.rootDomain);
  }
  return claimed;
}

export interface ProspectInput {
  rootDomain: string;
  exampleGuestPostUrl: string | null;
  exampleExternalLink: string | null;
  exclusionReason: string | null;
}

export async function saveProspects(campaignId: string, prospects: ProspectInput[]) {
  if (!prospects.length) return;
  await db
    .insert(guestPostProspects)
    .values(prospects.map((p) => ({ campaignId, ...p })))
    .onConflictDoNothing(); // re-running the filter for the same campaign is a no-op
}

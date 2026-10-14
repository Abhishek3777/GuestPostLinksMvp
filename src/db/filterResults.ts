import { eq, sql } from "drizzle-orm";
import { db, type Executor } from "./client.js";
import { appSettings, doNotContact, domainContactLedger, guestPostLinks, guestPostProspects } from "./schema.js";

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

// The app-wide re-contact cooldown (app_settings is a single row, id 1).
// Falls back to 90 if the row is somehow missing rather than erroring out —
// matches the field's own DB default, so a missing row behaves the same as
// a freshly-migrated one.
const DEFAULT_DEDUP_DAYS = 90;

export async function getDedupDays(): Promise<number> {
  const [row] = await db.select({ dedupDays: appSettings.dedupDays }).from(appSettings).where(eq(appSettings.id, 1));
  return row?.dedupDays ?? DEFAULT_DEDUP_DAYS;
}

// THE one dedup check — there must only ever be one (2026-10-13, explicit
// team decision: two separate mechanisms with different windows and
// trigger conditions existing side by side is exactly the confusing setup
// to avoid). Domains ANY OTHER campaign (anyone, any group) has actually
// found a real email or contact form for, within the app-wide cooldown
// window (the "Lead re-contact cooldown" setting on the Team page) — not
// merely kept as a prospect. Re-finding and re-emailing a domain we already
// have a working contact for is the actual spam risk; a domain we only ever
// considered and never successfully reached isn't.
//
// Reads from domain_contact_ledger, not guestPostProspects directly — this
// is deliberate and load-bearing: the ledger is the one thing designed to
// keep existing even after a campaign's own detailed data is eventually
// deleted (see the table's own comment in schema.ts), so this check keeps
// working regardless of the rest of that campaign's data lifecycle.
//
// Returns WHEN each claim happened, not just whether it did — so callers can
// say "claimed 31 days ago" instead of a bare label. One row per domain in
// the ledger (upserted, not accumulated), so there's never more than one
// candidate per domain to pick between.
export interface ClaimedBy {
  claimedAt: Date;
  campaignId: string | null;
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
    // `= any(${array})` interpolates a plain JS array as individual bound
    // parameters, not a real Postgres array literal — fails outright with
    // "op ANY/ALL (array) requires array on right side" (confirmed live,
    // 2026-10-12). sql.join + IN (...) is the pattern already proven
    // elsewhere in this session for the same class of query.
    const domainList = sql.join(domains.slice(i, i + 5000).map((d) => sql`${d}`), sql`, `);
    // IS DISTINCT FROM, not != — a ledger row whose campaign has since been
    // deleted has campaign_id null, and plain != against null is itself
    // null (never true) in SQL, which would wrongly let that row stop
    // counting as a claim the moment its campaign disappears.
    const rows = await executor.execute<{ domain: string; contacted_at: string; campaign_id: string | null }>(sql`
      select ${domainContactLedger.domain} as domain,
        ${domainContactLedger.contactedAt} as contacted_at, ${domainContactLedger.campaignId} as campaign_id
      from ${domainContactLedger}
      where ${domainContactLedger.campaignId} is distinct from ${campaignId}
        and ${domainContactLedger.contactedAt} > now() - make_interval(days => ${dedupDays})
        and ${domainContactLedger.domain} in (${domainList})
    `);
    for (const r of rows) claimed.set(r.domain, { claimedAt: new Date(r.contacted_at), campaignId: r.campaign_id });
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

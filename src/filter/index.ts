import { sql } from "drizzle-orm";
import { db, type Executor } from "../db/client.js";
import {
  findAlreadyFoundDomains,
  findClaimedGlobally,
  getDedupDays,
  getCampaignLinks,
  loadDoNotContactSet,
  saveProspects,
  type ProspectInput,
} from "../db/filterResults.js";
import { exclusionReason } from "./exclusions.js";

// Fixed, arbitrary key for the global dedup lock — every campaign takes the
// SAME advisory lock now (dedup is app-wide, not per-group), so this is just
// a constant rather than something derived per campaign.
const DEDUP_LOCK_KEY = sql`hashtext('guest-post-dedup')::bigint`;

export interface FilterStageResult {
  totalProspects: number;
  kept: number;
  excluded: number;
  byReason: Record<string, number>;
}

interface Candidate {
  rootDomain: string;
  exampleGuestPostUrl: string | null;
  exampleExternalLink: string | null;
}

async function decideAndSave(
  executor: Executor,
  campaignId: string,
  candidates: Candidate[],
  doNotContact: Set<string>,
  alreadyFound: Set<string>,
  dedupDays: number
): Promise<{ prospects: ProspectInput[]; byReason: Record<string, number> }> {
  // Every run, not just monitoring: a domain ANY other campaign already
  // claimed, whether or not contact lookup has even run on it yet.
  const claimedByOthers = await findClaimedGlobally(campaignId, candidates.map((c) => c.rootDomain), dedupDays, executor);

  const byReason: Record<string, number> = {};
  const prospects: ProspectInput[] = candidates.map((c) => {
    // The real exclusion rules (do-not-contact, big brands...) always win, then a
    // teammate's claim (checked before contact lookup wastes effort on it), then
    // "already found" by an older, unrelated campaign.
    const reason =
      exclusionReason(c.rootDomain, doNotContact) ||
      (claimedByOthers.has(c.rootDomain) ? "claimed_by_teammate" : "") ||
      (alreadyFound.has(c.rootDomain) ? "already_found" : "");
    if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
    return { ...c, exclusionReason: reason || null, claimedAt: claimedByOthers.get(c.rootDomain) ?? null };
  });

  await saveProspects(campaignId, prospects, executor);
  return { prospects, byReason };
}

async function filterAndSave(
  campaignId: string,
  candidates: Candidate[],
  opts: { incremental?: boolean } = {}
): Promise<FilterStageResult> {
  const doNotContact = await loadDoNotContactSet();
  // Monitoring runs only: leads an earlier run already found and looked up.
  const alreadyFound = opts.incremental
    ? await findAlreadyFoundDomains(campaignId, candidates.map((c) => c.rootDomain))
    : new Set<string>();
  const dedupDays = await getDedupDays();

  // The claim-check-then-save above is the one place two campaigns could race:
  // if two campaigns reach it at the same instant (possible once the daemon
  // runs more than one campaign at a time), both could see a domain as
  // unclaimed before either has saved theirs, and both would keep it — the
  // exact double-contact risk dedup exists to prevent. Dedup is now app-wide
  // (not per-group), so every campaign takes the SAME fixed advisory lock for
  // just this fast step, one at a time. The lock is held for the
  // transaction's lifetime and always releases, success or failure.
  const { prospects, byReason } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DEDUP_LOCK_KEY})`);
    return decideAndSave(tx, campaignId, candidates, doNotContact, alreadyFound, dedupDays);
  });

  const excluded = prospects.filter((p) => p.exclusionReason).length;
  return { totalProspects: prospects.length, kept: prospects.length - excluded, excluded, byReason };
}

// Stage 2 for "discovery" campaigns. Mirrors the legacy pipeline's
// build_contact_list.py: dedupe every link down to one row per unique root
// domain (first occurrence wins), then decide keep/exclude ONCE per target —
// not once per link row, since 50 links to the same domain is still one prospect.
export async function runFilterStage(
  campaignId: string,
  opts: { incremental?: boolean } = {}
): Promise<FilterStageResult> {
  const links = await getCampaignLinks(campaignId);

  const firstSeen = new Map<string, { guestPostUrl: string; externalLink: string }>();
  for (const link of links) {
    if (!firstSeen.has(link.rootDomain)) {
      firstSeen.set(link.rootDomain, { guestPostUrl: link.guestPostUrl, externalLink: link.externalLink });
    }
  }

  const candidates: Candidate[] = [...firstSeen.entries()].map(([rootDomain, rep]) => ({
    rootDomain,
    exampleGuestPostUrl: rep.guestPostUrl,
    exampleExternalLink: rep.externalLink,
  }));

  return filterAndSave(campaignId, candidates, opts);
}

// Stage 2 for "direct" campaigns. The uploaded domains ARE the targets —
// there's no guest post to dedupe from, but the DNC list and exclusion rules
// (especially "is this actually on the do-not-contact list") still apply
// unconditionally, same as the discovery flow.
export async function seedDirectProspects(campaignId: string, domains: string[]): Promise<FilterStageResult> {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  const candidates: Candidate[] = unique.map((rootDomain) => ({
    rootDomain,
    exampleGuestPostUrl: null,
    exampleExternalLink: null,
  }));

  return filterAndSave(campaignId, candidates);
}

import {
  findAlreadyFoundDomains,
  findClaimedByGroupmates,
  getCampaignLinks,
  loadDoNotContactSet,
  saveProspects,
  type ProspectInput,
} from "../db/filterResults.js";
import { exclusionReason } from "./exclusions.js";

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
  // Every run, not just monitoring: a domain a CURRENT group-mate's campaign
  // already claimed, whether or not contact lookup has even run on it yet.
  const claimedByGroupmates = await findClaimedByGroupmates(campaignId, candidates.map((c) => c.rootDomain));

  const byReason: Record<string, number> = {};
  const prospects: ProspectInput[] = candidates.map((c) => {
    // The real exclusion rules (do-not-contact, big brands...) always win, then a
    // teammate's claim (checked before contact lookup wastes effort on it), then
    // "already found" by an older, unrelated campaign.
    const reason =
      exclusionReason(c.rootDomain, doNotContact) ||
      (claimedByGroupmates.has(c.rootDomain) ? "claimed_by_teammate" : "") ||
      (alreadyFound.has(c.rootDomain) ? "already_found" : "");
    if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
    return { ...c, exclusionReason: reason || null };
  });

  await saveProspects(campaignId, prospects);

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

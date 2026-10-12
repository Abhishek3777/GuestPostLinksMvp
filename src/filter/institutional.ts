// Government and financial-institution/regulator site detection. Built fresh
// for this — no legacy reference exists (confirmed: the legacy pipeline's
// gov_edu_tld check is TLD-suffix-only, and doesn't even work for a real
// example here: e-visa.gov.uz isn't caught by suffix matching because the
// domain-parsing library doesn't treat "gov.uz" as a registered government
// suffix the way "gov.uk" is — "gov" ends up read as an ordinary word, not a
// suffix signal). Needs content, not just the domain name.
import { parse } from "tldts";

const GOVERNMENT_TITLE_TOKENS = [
  "government", "ministry", "embassy", "consulate", "parliament",
  "municipal", "municipality", "passport office", "immigration department",
  "tax authority", "revenue service", "public sector",
] as const;

// Multi-word phrases only — a bare "bank" would false-positive on legitimate
// companies that happen to use the word generically (e.g. a SaaS named
// "DataBank"). These are phrases a real bank's own marketing copy uses, not
// words an unrelated business would stumble into by coincidence.
const FINANCIAL_INSTITUTION_TITLE_PHRASES = [
  "central bank", "reserve bank", "national bank", "banking corporation",
  "corporate banking", "nri banking", "personal banking", "retail banking",
] as const;

function titleOf(pageText: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(pageText);
  return (match?.[1] ?? "").toLowerCase();
}

// Domain-structure check — catches icici.bank.in directly from the domain
// itself (suffix "bank.in"), independent of page content.
export function domainLooksLikeBank(rootDomain: string): boolean {
  const parsed = parse(rootDomain.trim().toLowerCase(), { allowPrivateDomains: false });
  const suffixLabels = (parsed.publicSuffix ?? "").split(".");
  return suffixLabels.includes("bank");
}

export function looksLikeGovOrInstitutional(rootDomain: string, pageText: string): boolean {
  if (domainLooksLikeBank(rootDomain)) return true;
  const title = titleOf(pageText);
  if (GOVERNMENT_TITLE_TOKENS.some((tok) => title.includes(tok))) return true;
  if (FINANCIAL_INSTITUTION_TITLE_PHRASES.some((phrase) => title.includes(phrase))) return true;
  return false;
}

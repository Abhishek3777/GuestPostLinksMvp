// Ported from the legacy Python pipeline's exclusions.py (audited, in
// production use — "great job, accuracy is great" per the user's own
// review). Matches its rule set and precedence order exactly; validated
// against its real excluded_domains.csv output (see validate.ts).
//
// MATCH EXACT LABELS, NEVER SUBSTRINGS. Substring matching on the brand list
// would drop jaynike.com ("nike"), spotifystorm.com, tiktokstorm.com,
// youtubestorm.com, pinterestclick.com and streamoz.com ("moz.com") — all
// SMM resellers, which are exactly the kind of site that DOES buy links.
import { parse } from "tldts";

export type ExclusionReason =
  | "do_not_contact"
  | "gov_edu_tld"
  | "excluded_domain"
  | "parked_domain"
  | "url_shortener"
  | "invalid_domain"
  | "big_brand"
  | "";

// TLDs matched per label of the public suffix, so "gov.uk" and "edu.sg" are
// caught while "com.au" and "co.uk" are untouched — country TLDs are
// deliberately NOT excluded, .com.au and .co.uk are among the best prospects.
const EXCLUDED_SUFFIX_LABELS = new Set(["gov", "edu", "mil"]);

// Sites that will never buy a guest-post link. EXACT label match only.
const EXCLUDED_BRAND_LABELS = new Set([
  // search, portals, encyclopedias
  "google", "googleblog", "bing", "yahoo", "duckduckgo", "baidu", "yandex",
  "wikipedia", "wikimedia", "wiktionary", "wikihow", "britannica", "ehow",
  "quora", "reddit", "medium", "tumblr", "blogspot",
  // SEO / marketing tools
  "ahrefs", "semrush", "moz", "majestic", "similarweb", "spyfu", "ubersuggest",
  "screamingfrog", "searchenginejournal", "searchengineland", "backlinko",
  // big media / news
  "bbc", "cnn", "nytimes", "theguardian", "forbes", "reuters", "bloomberg",
  "wsj", "washingtonpost", "huffpost", "businessinsider", "techcrunch",
  "theverge", "wired", "mashable", "engadget", "cnet", "zdnet", "gizmodo",
  "entrepreneur", "inc", "fastcompany", "time", "newsweek", "usatoday",
  "telegraph", "independent", "dailymail", "mirror", "express", "metro",
  // health / reference authorities
  "webmd", "healthline", "mayoclinic", "clevelandclinic", "medlineplus",
  "who", "nhs", "psychologytoday", "verywellhealth", "drugs",
  // finance reference
  "investopedia", "nerdwallet", "bankrate", "creditkarma", "experian",
  "equifax", "transunion", "morningstar", "fool",
  // SaaS / tech majors
  "microsoft", "apple", "adobe", "oracle", "ibm", "salesforce", "sap",
  "hubspot", "mailchimp", "shopify", "wordpress", "wix", "squarespace",
  "godaddy", "cloudflare", "atlassian", "slack", "zoom", "dropbox", "canva",
  "openai", "anthropic",
  // marketplaces / commerce
  "amazon", "ebay", "walmart", "target", "etsy", "alibaba", "aliexpress",
  "bestbuy", "costco", "homedepot", "ikea",
  // social / video
  "facebook", "instagram", "twitter", "linkedin", "pinterest", "youtube",
  "tiktok", "snapchat", "whatsapp", "telegram", "discord", "twitch",
  "spotify", "netflix", "vimeo",
  // dev platforms
  "github", "gitlab", "stackoverflow", "stackexchange", "npmjs", "pypi",
  "mozilla", "w3schools", "geeksforgeeks", "freecodecamp",
  // travel / listings majors
  "tripadvisor", "booking", "expedia", "airbnb", "yelp", "zillow", "indeed",
  "glassdoor", "craigslist",
]);

// Full registrable domains to drop that the label rule would miss or misfire on.
const EXCLUDED_ROOT_DOMAINS = new Set([
  "googleusercontent.com", "googleapis.com", "gstatic.com", "goo.gl",
  "youtu.be", "fb.me", "t.co", "amzn.to", "wp.me",
  "archive.org", "web.archive.org", "creativecommons.org",
  "schema.org", "w3.org", "doi.org", "ncbi.nlm.nih.gov",
  // Public bodies whose registrable domain is itself a public suffix, so the
  // gov/edu label rule can't see them (nhs.uk, police.uk are in the PSL).
  "nhs.uk", "police.uk", "parliament.uk", "mod.uk", "europa.eu",
]);

// Domain-for-sale / parking services. A redirect into one of these means the
// original domain is dead.
const PARKED_DOMAINS = new Set([
  "sedo.com", "dan.com", "hugedomains.com", "afternic.com", "bodis.com",
  "parkingcrew.net", "undeveloped.com", "namecheap.com", "buydomains.com",
  "domainmarket.com", "squadhelp.com", "atom.com",
]);

// URL shorteners — a redirect ending here is unresolved, not a real destination.
const SHORTENERS = new Set([
  "bit.ly", "t.co", "goo.gl", "tinyurl.com", "ow.ly", "buff.ly", "lnkd.in",
  "rebrand.ly", "cutt.ly", "is.gd", "shorturl.at",
]);

// ('cancer.gov') -> {label: 'cancer', suffix: 'gov'};  ('ncsc.gov.uk') -> {label: 'ncsc', suffix: 'gov.uk'}
function splitDomain(rootDomain: string): { label: string | null; suffix: string | null } {
  const parsed = parse(rootDomain.trim().toLowerCase(), { allowPrivateDomains: false });
  return { label: parsed.domainWithoutSuffix ?? null, suffix: parsed.publicSuffix ?? null };
}

export function exclusionReason(rootDomain: string, doNotContact: Set<string>): ExclusionReason {
  if (!rootDomain) return "invalid_domain";
  const d = rootDomain.trim().toLowerCase();
  const withoutWww = d.startsWith("www.") ? d.slice(4) : d;

  // Checked FIRST and unconditionally: an opt-out or existing client must
  // override every other rule, including "this is actually a big brand".
  // Exact registrable-domain match only — homify.com on the list does NOT
  // also block homify.co.uk. Reverted per explicit instruction: label-based
  // matching was judged too risky/unpredictable for this list.
  const initial = splitDomain(withoutWww);
  if (initial.label && initial.suffix && doNotContact.has(`${initial.label}.${initial.suffix}`)) {
    return "do_not_contact";
  }

  // Suffix check runs next, on the UNMODIFIED name. Some government sites sit
  // directly on a public suffix — for www.gov.uk the registrable domain
  // really is "www.<suffix>". Stripping "www." first would misreport it.
  const unmodified = splitDomain(d);
  if (unmodified.suffix && unmodified.suffix.split(".").some((s) => EXCLUDED_SUFFIX_LABELS.has(s))) {
    return "gov_edu_tld";
  }

  const { label, suffix } = splitDomain(withoutWww);
  const registrable = label && suffix ? `${label}.${suffix}` : withoutWww;

  if (EXCLUDED_ROOT_DOMAINS.has(registrable)) return "excluded_domain";
  if (PARKED_DOMAINS.has(registrable)) return "parked_domain";
  if (SHORTENERS.has(registrable)) return "url_shortener";
  if (!label || !suffix) return "invalid_domain";
  if (suffix.split(".").some((s) => EXCLUDED_SUFFIX_LABELS.has(s))) return "gov_edu_tld";
  if (EXCLUDED_BRAND_LABELS.has(label)) return "big_brand";
  return "";
}

// --- gambling: hijacked domains only ---------------------------------------
// NOT implemented here. In the legacy pipeline this check runs in
// merge_contacts.py, AFTER the contact scrape, because it needs the target
// page's actual content classified as gambling-or-not — data Stage 2 doesn't
// have yet. It belongs alongside Stage 3 (contact scraping), not here.

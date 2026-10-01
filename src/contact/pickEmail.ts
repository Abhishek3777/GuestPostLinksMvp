// Choose ONE outreach address per domain out of a scraped set.
//
// Ported faithfully from pick_email.py (see ../../PICK-EMAIL-README.md for the
// full design notes) — tuned for guest-post PLACEMENT outreach: we want an
// article published on their site, so the winner is whoever can approve that
// (editor@, guestpost@, submissions@), not a generic business inbox. If this
// ever needs to sell a service TO the company instead, swap the editorial and
// comms bands below.
//
// Pure, deterministic, no network/model calls — this runs once per lead
// across tens of thousands of rows per campaign.
//
// `names` (confirms a personal mailbox from a scraped contact name) isn't
// wired up here since we don't scrape names — that one branch of the original
// never fires without it, so it's omitted rather than carried as dead code.

// Nobody reads these. Never pick one, even if it is the only address.
const NEVER = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "noreplay",
  "mailer-daemon", "postmaster", "abuse", "unsubscribe", "bounce", "bounces",
  "spam", "phishing", "dmarc", "dkim", "root", "daemon", "automated",
  "notifications", "notification", "alerts", "system",
]);

// One score per token. Individual values, not flat tiers, so near-equivalent
// mailboxes still resolve deterministically instead of falling to a tie-break.
const ROLE_SCORES: Record<string, number> = {
  // A. editorial: the route that actually publishes articles
  guestpost: 100, guestposts: 100, guestposting: 100, writeforus: 100,
  submissions: 99, submission: 99, submit: 97, contribute: 97,
  contributor: 96, contributors: 96, contributing: 96,
  editor: 95, editors: 95, editorial: 95,
  pitch: 93, pitches: 93, content: 92, blog: 92, blogs: 92,
  writers: 91, writer: 91, write: 91, articles: 90, article: 90,
  newsdesk: 90, desk: 88, publishing: 87, publisher: 87,
  newsroom: 86, features: 85, posts: 82, news: 80,

  // B. commercial placement: the route that sells a placement
  collaborations: 84, collaboration: 84, collabs: 84, collab: 84,
  partnerships: 83, partnership: 83, partners: 82, partner: 82,
  sponsorship: 81, sponsorships: 81, sponsored: 81, sponsor: 80,
  advertising: 79, advertise: 79, advertisement: 79, ads: 78,
  adv: 78, affiliates: 74, affiliate: 74,

  // C. comms: not the decision maker, but forwards to one
  press: 72, seo: 72, media: 71, publicity: 71, pr: 70,
  comms: 69, communications: 69, outreach: 68, marketing: 67,
  brand: 64, digital: 62, growth: 60, bizdev: 60, bd: 58,

  // D. generic front doors: monitored, but you are starting from zero
  webmaster: 52, hello: 50, contact: 50, contactus: 50,
  enquiries: 49, enquiry: 49, inquiries: 49, inquiry: 49,
  hi: 48, info: 47, hey: 46, office: 45, team: 45, hq: 44,
  general: 44, mail: 43, email: 42, admin: 42, all: 40,
  social: 40, socialmedia: 40, community: 35, events: 30, event: 30,

  // E. wrong department: a reply here is a forward at best
  sales: 25, support: 20, help: 20, helpdesk: 20, service: 20,
  services: 20, customer: 20, customercare: 20, care: 20,
  guest: 18, guests: 18, booking: 18, bookings: 18,
  reservations: 18, reservation: 18, orders: 18, order: 18,
  shop: 18, store: 18, concierge: 16, frontdesk: 16, returns: 14,
  billing: 14, accounts: 14, accounting: 14, invoice: 14,
  invoices: 14, finance: 14, payments: 14, people: 12, tech: 12,
  dev: 12, developers: 12, training: 12, careers: 10, career: 10,
  jobs: 10, job: 10, recruitment: 10, recruiting: 10, hr: 10,
  talent: 10, legal: 8, privacy: 8, dpo: 8, compliance: 8,
  gdpr: 8, it: 8, security: 8,
};

// "guest" is a trap. On a hotel it means guest services; on a blog it means
// guest posting. Only the company it keeps tells you which.
const PHRASE_OVERRIDES: [Set<string>, number][] = [
  [new Set(["guest", "post"]), 100], [new Set(["guest", "posts"]), 100],
  [new Set(["guest", "posting"]), 100], [new Set(["guest", "blog"]), 100],
  [new Set(["guest", "article"]), 100], [new Set(["guest", "author"]), 100],
  [new Set(["guest", "contributor"]), 100], [new Set(["guest", "writer"]), 96],
  [new Set(["write", "us"]), 100], [new Set(["be", "contributor"]), 96],
];

const PERSON_SCORE = 60; // a named human: worse than editor@, better than info@
const UNKNOWN_SCORE = 35; // one word we cannot classify: a gamble
const REGION_ONLY_SCORE = 38; // a regional desk with no role: needs a target region

const REGIONS = new Set([
  // ISO country codes
  "us", "usa", "uk", "gb", "ca", "au", "nz", "ie", "de", "fr", "es", "it",
  "nl", "be", "ch", "at", "se", "no", "dk", "fi", "pl", "cz", "pt", "gr",
  "tr", "ru", "ua", "cn", "jp", "kr", "in", "sg", "hk", "tw", "th", "my",
  "id", "ph", "vn", "ae", "sa", "qa", "kw", "il", "za", "ng", "ke", "eg",
  "br", "mx", "ar", "cl", "co", "pe",
  // IATA city codes, common in multi-office mailboxes
  "nyc", "lax", "sfo", "lon", "ldn", "dxb", "auh", "mad", "bcn", "par",
  "cdg", "ber", "muc", "ams", "fco", "mil", "sin", "hkg", "tyo", "nrt",
  "syd", "mel", "yyz", "yvr", "chi", "ord", "mia", "atl", "bos", "sea",
  "den", "phx", "del", "bom", "blr", "maa", "hyd", "dub", "zrh", "gva",
  "vie", "cph", "osl", "sto", "hel", "waw", "prg", "bud", "ist", "jnb",
  "cpt", "gru", "mex", "bog", "scl", "lim",
  // regions and spelled-out cities
  "emea", "apac", "latam", "amer", "americas", "europe", "european", "asia",
  "mena", "anz", "global", "intl", "international", "worldwide",
  "dubai", "madrid", "singapore", "london", "newyork", "sydney", "tokyo",
  "berlin", "paris", "mumbai", "delhi", "toronto", "barcelona", "amsterdam",
]);

// Two-letter tokens that are a department far more often than a country.
// pr=public relations not Puerto Rico, it=IT not Italy, hr=HR not Croatia.
// Role vocabulary always wins for these.
const AMBIGUOUS_SHORT = new Set([
  "pr", "hr", "it", "no", "is", "at", "in", "me", "so", "be",
  "do", "ad", "ai", "io", "my", "us", "as", "by", "to", "sh",
  "st", "tv", "id", "ch", "co", "se", "ca", "la",
]);

const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "hotmail.com", "outlook.com", "live.com", "aol.com",
  "icloud.com", "protonmail.com", "proton.me", "gmx.com",
  "mail.com", "yandex.com", "qq.com", "163.com",
]);

const SPLIT_RE = /[._\-+]+/;
const TRAILING_DIGITS_RE = /\d+$/;

// The company's name as one lowercase alnum string, best effort. An
// own-domain address gives it directly (iwtrading-gmbh.com -> iwtradinggmbh).
// When every address is on gmail or similar, it is whatever word repeats
// across the local parts: zitroen in digitalzitroen / zitroen.iot / zitroen.info.
function inferBrand(emails: string[]): string {
  for (const e of emails) {
    const dom = e.split("@")[1];
    if (!FREE_PROVIDERS.has(dom)) return dom.split(".")[0].replace(/[^a-z0-9]/g, "");
  }
  const locals = emails.map((e) => e.split("@")[0].split("+")[0]);
  const words = new Set<string>();
  for (const l of locals) {
    for (const t of l.split(SPLIT_RE)) {
      if (t.length >= 4 && /^[a-z]+$/.test(t) && !(t in ROLE_SCORES) && !REGIONS.has(t)) words.add(t);
    }
  }
  for (const w of [...words].sort((a, b) => a.length - b.length)) {
    const count = locals.filter((l) => l.includes(w)).length;
    if (count >= 2) return w;
  }
  return "";
}

// Pull a no-separator token apart when the brand is inside it.
// salesiwtradinggmbh -> sales + iwtradinggmbh, digitalzitroen -> digital +
// zitroen, sgedition -> sg + edition. Only splits when the remainder is the
// brand, so ordinary words stay whole.
function splitGlued(tok: string, brand: string): string[] | null {
  if (!brand || tok === brand) return null;
  if (tok.startsWith(brand) && tok.slice(brand.length) in ROLE_SCORES) {
    return [brand, tok.slice(brand.length)];
  }
  const i = tok.indexOf(brand);
  if (i > 0 && (tok.slice(0, i) in ROLE_SCORES || REGIONS.has(tok.slice(0, i)))) {
    return [tok.slice(0, i), brand]; // trailing gmbh/ltd is dropped with the brand
  }
  for (const n of [2, 3]) {
    const head = tok.slice(0, n);
    const tail = tok.slice(n);
    if (REGIONS.has(head) && tail.length >= 3 && brand.includes(tail)) return [head, tail];
  }
  return null;
}

// Split a local part into comparable tokens. Drops plus-addressing, strips
// trailing digits (info2 -> info), and pulls brand-glued tokens apart.
function tokenize(local: string, brand: string): string[] {
  const withoutTag = local.split("+")[0];
  const out: string[] = [];
  for (const raw of withoutTag.split(SPLIT_RE)) {
    if (!raw) continue;
    const tok = raw.replace(TRAILING_DIGITS_RE, "") || raw;
    if (tok in ROLE_SCORES || REGIONS.has(tok)) {
      out.push(tok);
    } else {
      out.push(...(splitGlued(tok, brand) ?? [tok]));
    }
  }
  return out;
}

interface Scored {
  email: string;
  score: number;
  role: string | null;
  regions: string[];
  reason: string;
  free: boolean;
}

// Score one address. Role tokens beat region tokens; the best role wins.
function classify(email: string, brand: string): Scored {
  const at = email.indexOf("@");
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  const toks = tokenize(local, brand);

  if (toks.some((t) => NEVER.has(t)) || NEVER.has(local)) {
    return { email, score: -1, role: null, regions: [], reason: "automated mailbox, never monitored", free: false };
  }

  let role: string | null = null;
  let score: number | null = null;
  for (const t of toks) {
    if (t in ROLE_SCORES && (score === null || ROLE_SCORES[t] > score)) {
      role = t;
      score = ROLE_SCORES[t];
    }
  }
  for (const [phrase, bonus] of PHRASE_OVERRIDES) {
    const isSubset = [...phrase].every((p) => toks.includes(p));
    if (isSubset && (score === null || bonus > score)) {
      role = [...phrase].sort().join("+");
      score = bonus;
    }
  }

  const regions = toks.filter((t) => REGIONS.has(t) && !(t in ROLE_SCORES) && !(AMBIGUOUS_SHORT.has(t) && t !== role));
  const leftovers = toks.filter((t) => !(t in ROLE_SCORES) && !regions.includes(t) && t !== brand);

  let reason: string;
  if (score === null) {
    if (role === null && leftovers.length === 2 && leftovers.every((t) => /^[a-z]+$/.test(t))) {
      score = PERSON_SCORE;
      reason = "looks like a personal mailbox";
    } else if (regions.length > 0 && leftovers.length === 0) {
      score = REGION_ONLY_SCORE;
      reason = "regional desk, no role in the address";
    } else {
      score = UNKNOWN_SCORE;
      reason = "unrecognised mailbox";
    }
  } else {
    reason = `role "${role}" (${score})`;
    if (regions.length > 0) reason += " + region " + regions.join("/");
  }

  return { email, score, role, regions, reason, free: FREE_PROVIDERS.has(domain) };
}

export interface PickResult {
  primary: string | null;
  fallback: string | null;
  confidence: "high" | "medium" | "low" | "none";
  needsReview: boolean;
  reason: string;
  allFree: boolean;
  scored: Scored[];
}

// Choose the single address to put in the sequence. Tie-breaks run in a fixed
// order so a rerun always returns the same pick: score, then region match,
// then fewer tokens, then shorter, then alphabetical.
export function pickEmail(rawEmails: string[], targetRegion?: string): PickResult {
  const emails = [...new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))].sort();
  if (emails.length === 0) {
    return { primary: null, fallback: null, confidence: "none", needsReview: true, reason: "no addresses", allFree: false, scored: [] };
  }

  const brand = inferBrand(emails);
  const allFree = emails.every((e) => FREE_PROVIDERS.has(e.split("@")[1]));
  const scored = emails.map((e) => classify(e, brand));

  // Set-level signal: several bare region codes mean regional desks, and a
  // single address cannot tell you that.
  const bareRegions = scored.filter((c) => c.role === null && c.regions.length > 0);
  if (bareRegions.length < 2) {
    for (const c of scored) {
      if (c.score === REGION_ONLY_SCORE) {
        c.score = UNKNOWN_SCORE;
        c.reason = "unrecognised mailbox";
      }
    }
  }

  const live = scored.filter((c) => c.score >= 0);
  if (live.length === 0) {
    return { primary: null, fallback: null, confidence: "none", needsReview: true, reason: "every address is an automated mailbox", allFree, scored };
  }

  function sortKey(c: Scored): [number, number, number, number, string] {
    const local = c.email.split("@")[0];
    return [
      -c.score,
      targetRegion && c.regions.includes(targetRegion) ? 0 : 1,
      local.split(SPLIT_RE).length,
      local.length,
      c.email,
    ];
  }
  live.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });

  const best = live[0];
  const second = live[1] ?? null;
  const margin = second ? best.score - second.score : 99;

  // Same role, different region: the score cannot separate them, only a
  // target region can.
  const regionalTie = Boolean(second && margin === 0 && (best.regions.length > 0 || second.regions.length > 0) && best.role === second.role);
  const resolved = Boolean(targetRegion && best.regions.includes(targetRegion));

  // A small margin between two STRONG addresses is not uncertainty: either one
  // reaches the right team. Margin only earns its keep lower down the table.
  let confidence: PickResult["confidence"];
  if (best.score >= 80 || (best.score >= 67 && margin >= 10)) confidence = "high";
  else if (best.score >= 42) confidence = "medium";
  else confidence = "low";
  if ((regionalTie || best.score === REGION_ONLY_SCORE) && !resolved) confidence = "low";
  if (resolved) confidence = "high";

  let reason = best.reason;
  if (regionalTie && !resolved) reason += "; tied with " + second!.email + " on region, set targetRegion";
  else if (resolved) reason += "; matches target region " + targetRegion;
  if (best.free) reason += "; free provider, likely a real person";

  return {
    primary: best.email,
    fallback: second?.email ?? null,
    confidence,
    needsReview: confidence === "low",
    reason,
    allFree,
    scored: [...scored].sort((a, b) => b.score - a.score),
  };
}

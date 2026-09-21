import { getDomain } from "tldts";

// Decides which of the emails found on a site are worth keeping. A site often
// shows a handful (sales@, accounts@, support@, a webmaster credit...) and only
// some of them are somebody you'd pitch. Kept emails come back best-first, so
// the first one is always the primary; everything else is returned separately
// so it can be reported instead of silently dropped.

export interface EmailCandidate {
  email: string;
  // Found in a deliberate mailto: link (or a decoded Cloudflare-protected one),
  // as opposed to being spotted in running text. A deliberate link is a
  // stronger signal that the site wants to be emailed there.
  viaMailto: boolean;
}

export interface RankedEmails {
  kept: string[]; // best first — kept[0] is the primary
  other: string[]; // found but not kept, best first
}

export const MAX_KEPT_EMAILS = 3;

// Free-mail addresses are common for small blogs and one-person sites, so they
// are a legitimate contact — just not as strong as an address on the site's own
// domain.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.in", "outlook.com", "hotmail.com",
  "hotmail.co.uk", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru", "rediffmail.com",
]);

// People who take pitches: editorial, partnerships, advertising, marketing.
const STRONG_ROLES = new Set([
  "editor", "editors", "editorial", "guestpost", "guestposts", "guestposting", "guest", "contribute",
  "contributor", "contributors", "contributions", "submissions", "submission", "submit", "write", "writers",
  "writeforus", "pitch", "pitches", "partnership", "partnerships", "partner", "partners", "collab",
  "collaborate", "collaboration", "collaborations", "advertise", "advertising", "advertisement", "ads",
  "adsales", "sponsor", "sponsors", "sponsorship", "sponsorships", "sponsored", "media", "press", "pr",
  "publicity", "outreach", "marketing", "seo", "content", "blog", "news", "newsdesk", "tips",
]);

// Generic but real inboxes a person reads.
const GOOD_ROLES = new Set([
  "sales", "business", "biz", "hello", "hi", "hey", "info", "information", "contact", "contactus", "team",
  "enquiries", "enquiry", "inquiries", "inquiry", "mail", "office", "general", "connect", "talk", "say",
]);

// Inboxes that exist for something other than being pitched, or that nobody
// reads. These lose to any real contact, and are only kept when nothing better
// exists at all.
const WEAK_ROLES = new Set([
  "accounts", "account", "accounting", "billing", "bill", "invoice", "invoices", "payment", "payments",
  "finance", "payroll", "ar", "ap", "support", "help", "helpdesk", "customerservice", "customercare",
  "customersupport", "service", "services", "cs", "careers", "career", "jobs", "job", "hr", "recruiting",
  "recruitment", "talent", "orders", "order", "returns", "refunds", "shipping", "legal", "privacy", "dpo",
  "gdpr", "compliance", "copyright", "dmca", "abuse", "security", "webmaster", "postmaster", "hostmaster",
  "noreply", "donotreply", "mailerdaemon", "bounce", "bounces", "notifications", "notification", "alerts",
  "unsubscribe", "newsletter", "subscribe", "reservations", "bookings", "booking",
]);

// Role words that are unmistakable even when glued to something else, e.g.
// "accountsreceivable", "customer-support-uk", "hr.recruitment".
const WEAK_STEMS =
  /account|billing|invoice|payable|receivable|payroll|noreply|donotreply|helpdesk|customerservice|customercare|customersupport|recruit|unsubscribe|webmaster|postmaster|privacy|compliance|mailerdaemon/;

type Role = "strong" | "good" | "weak" | "personal" | "neutral";

function classifyLocalPart(local: string): Role {
  const lower = local.toLowerCase().split("+")[0]!; // drop "+tag" aliases
  const whole = lower.replace(/[._-]/g, "");
  const firstToken = lower.split(/[._-]/)[0]!;

  // Weak wins over everything: "accounts.sales" is still an accounts inbox.
  if (WEAK_ROLES.has(whole) || WEAK_ROLES.has(firstToken) || WEAK_STEMS.test(whole)) return "weak";
  if (STRONG_ROLES.has(whole) || STRONG_ROLES.has(firstToken)) return "strong";
  if (GOOD_ROLES.has(whole) || GOOD_ROLES.has(firstToken)) return "good";
  // "sarah", "sarah.jones", "s-jones": a real person's inbox.
  if (/^[a-z]{2,}([._-][a-z]{1,})?$/.test(lower)) return "personal";
  return "neutral";
}

const ROLE_SCORE: Record<Role, number> = { strong: 60, personal: 50, good: 40, neutral: 25, weak: -50 };

function registrable(host: string): string {
  return getDomain(host) ?? host.toLowerCase();
}

type Scored = EmailCandidate & { role: Role; onDomain: boolean; freeMail: boolean; score: number };

/**
 * `siteDomains` are the domains this contact info is FOR (the crawled domain
 * and, if it redirected, where it landed) — an address on one of them is far
 * more likely to be the real owner than one on a stranger's domain such as a
 * theme vendor or a "site by ..." credit.
 */
export function rankEmails(candidates: EmailCandidate[], siteDomains: string[]): RankedEmails {
  const siteRoots = new Set(siteDomains.filter(Boolean).map(registrable));

  // De-duplicate case-insensitively, remembering whether ANY sighting was a mailto.
  const unique = new Map<string, EmailCandidate>();
  for (const c of candidates) {
    const email = c.email.trim().toLowerCase();
    const seen = unique.get(email);
    unique.set(email, { email, viaMailto: c.viaMailto || Boolean(seen?.viaMailto) });
  }

  const scored: Scored[] = [...unique.values()].map((c) => {
    const [local, host = ""] = c.email.split("@");
    const role = classifyLocalPart(local!);
    const onDomain = siteRoots.has(registrable(host));
    const freeMail = !onDomain && FREE_MAIL_DOMAINS.has(host);
    const domainScore = onDomain ? 30 : freeMail ? 10 : -20;
    return { ...c, role, onDomain, freeMail, score: ROLE_SCORE[role] + domainScore + (c.viaMailto ? 5 : 0) };
  });
  scored.sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));

  const eligible = scored.filter((s) => s.role !== "weak");
  const trusted = eligible.filter((s) => s.onDomain || s.freeMail);

  let kept: Scored[];
  if (trusted.length > 0) {
    kept = trusted.slice(0, MAX_KEPT_EMAILS);
  } else {
    const offDomain = eligible.find((s) => s.viaMailto); // a stranger's domain is only trusted if it was a deliberate link
    if (offDomain) {
      kept = [offDomain];
    } else {
      // Nothing but role inboxes (accounts@, support@...). Better one of those
      // than no lead at all — but only from the site's own domain / a free-mail.
      const fallback = scored.find((s) => s.onDomain || s.freeMail);
      kept = fallback ? [fallback] : [];
    }
  }

  const keptSet = new Set(kept.map((k) => k.email));
  return {
    kept: kept.map((k) => k.email),
    other: scored.filter((s) => !keptSet.has(s.email)).map((s) => s.email),
  };
}

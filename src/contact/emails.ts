import * as cheerio from "cheerio";
import { getDomain } from "tldts";

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SINGLE_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/; // no /g: .test() on a global regex is stateful

// Addresses that show up constantly as false positives — tracking pixels,
// widget vendors, and generic placeholder text embedded in themes/scripts,
// not anything a real outreach email should go to.
const JUNK_EMAIL_DOMAINS = new Set([
  "sentry.io", "wixpress.com", "godaddy.com", "cloudflare.com", "example.com",
  "domain.com", "yourdomain.com", "email.com", "sentry-next.wixpress.com",
  "schema.org", "w3.org", "godaddy.com.au",
]);

function isJunkEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return (
    !domain ||
    JUNK_EMAIL_DOMAINS.has(domain) ||
    // "jquery@3.6.0.min.js", "logo@2x.png" — file names that happen to contain an @
    /\.(png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|eot)$/i.test(email)
  );
}

// --- Cloudflare "Email Address Obfuscation" ------------------------------------
// Many sites behind Cloudflare never show their email in the HTML at all.
// Cloudflare swaps it for either
//   <a href="/cdn-cgi/l/email-protection#7a1b1c1d...">[email protected]</a>
//   <span class="__cf_email__" data-cfemail="7a1b1c1d...">[email protected]</span>
// where the hex string IS the address, scrambled: the first byte is a key and
// every following byte is a character XOR-ed with that key. A browser undoes
// it with a small script; a scraper just sees "[email protected]" and finds
// nothing. Undoing it here is a few lines, and recovers exactly the emails a
// site went out of its way to hide from bots but still shows to visitors.
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

// --- Hand-written obfuscation --------------------------------------------------
// "info [at] example [dot] com", "info (at) example (dot) com" and the fully
// spelled-out "info at example dot com". A bare " at " next to a normal domain
// is NOT treated as an @ ("meet me at starbucks.com" is not an email), so the
// spelled-out form needs "dot" as well.
const AT_BRACKETED = String.raw`(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})`;
const DOT_ANY = String.raw`(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|\s+dot\s+|\.)`;
const DOT_WORD = String.raw`(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|\s+dot\s+)`;
const OBFUSCATED_BRACKET_AT = new RegExp(
  String.raw`([a-z0-9._%+-]+)\s*${AT_BRACKETED}\s*([a-z0-9-]+(?:\s*${DOT_ANY}\s*[a-z0-9-]+)+)`,
  "gi"
);
const OBFUSCATED_SPELLED = new RegExp(
  String.raw`(?<![a-z0-9._%+-])([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+(?:\s*${DOT_WORD}\s*[a-z0-9-]+)+)`,
  "gi"
);
const WELL_FORMED = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export function findObfuscatedEmails(text: string): string[] {
  const out: string[] = [];
  for (const re of [OBFUSCATED_BRACKET_AT, OBFUSCATED_SPELLED]) {
    for (const m of text.matchAll(re)) {
      const domain = m[2]!.replace(new RegExp(String.raw`\s*${DOT_ANY}\s*`, "gi"), ".").replace(/\s+/g, "");
      const email = `${m[1]}@${domain}`;
      if (WELL_FORMED.test(email)) out.push(email.toLowerCase());
    }
  }
  return out;
}

export interface DetectedEmail {
  email: string;
  // From a deliberate mailto: link (including a decoded Cloudflare one) rather
  // than being spotted in running text.
  viaMailto: boolean;
}

export function extractEmailsDetailed(html: string): DetectedEmail[] {
  const $ = cheerio.load(html);
  const found = new Map<string, boolean>(); // email -> viaMailto
  const add = (raw: string, viaMailto: boolean) => {
    const email = raw.trim().toLowerCase();
    if (!email || isJunkEmail(email)) return;
    found.set(email, viaMailto || Boolean(found.get(email)));
  };

  // Cloudflare-protected addresses. Done BEFORE the script/style strip below
  // and independent of it: they live in attributes, not in script text.
  $("[data-cfemail]").each((_, el) => {
    const decoded = decodeCloudflareEmail($(el).attr("data-cfemail") ?? "");
    if (decoded) add(decoded, true);
  });
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const hex = ($(el).attr("href") ?? "").split("email-protection#")[1] ?? "";
    const decoded = decodeCloudflareEmail(hex);
    if (decoded) add(decoded, true);
  });

  $("script, style").remove();

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const raw = href.replace(/^mailto:/i, "").split("?")[0].trim();
    // mailto hrefs are sometimes URL-encoded ("mailto:%20info@site.com") —
    // decode before trimming, or a literal "%20" survives as text since
    // .trim() only strips real whitespace, not an encoded sequence.
    let address = raw;
    try {
      address = decodeURIComponent(raw).trim();
    } catch {
      // malformed percent-encoding — fall back to the raw value
    }
    // "mailto:a@x.com,b@x.com" is several addresses in one link
    for (const part of address.split(/[;,]/)) if (SINGLE_EMAIL.test(part.trim())) add(part, true);
  });

  // cheerio's .text() concatenates across EVERY element with NO separating
  // whitespace — "email@site.com</span> response text" becomes
  // "email@site.comresponse text" with nothing to tell the regex where the
  // TLD actually ends. A curated list of "block-level" tags missed this on
  // foundrlist.com (the adjacent text wasn't in a tag on that list) — every
  // element gets the separator now, not just the ones we've seen break so far.
  $("*").after(" ");
  const bodyText = $("body").text();
  for (const match of bodyText.match(EMAIL_PATTERN) ?? []) add(match, false);
  for (const email of findObfuscatedEmails(bodyText)) add(email, false);

  return [...found].map(([email, viaMailto]) => ({ email, viaMailto }));
}

export function extractEmails(html: string): string[] {
  return extractEmailsDetailed(html).map((d) => d.email);
}

// --- "This site has moved" notices -------------------------------------------------
// Some retired sites stay up as a one-line notice ("X is now part of Y") with no
// redirect at all. The destination is where the business actually lives now.
// Notice pages are tiny by nature, so only a small page qualifies — otherwise a
// real site that merely mentions a merger in a headline would be read as moved.
const SUCCESSOR_PHRASE =
  /is now (?:a )?part of|has (?:now )?moved to|has merged with|has been acquired by|now redirects to|content has moved to|please visit (?:us at|our new)/i;
const MAX_NOTICE_TEXT_CHARS = 1500;

export function detectSuccessorNotice(html: string, originalDomain: string): string | null {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  if (text.length > MAX_NOTICE_TEXT_CHARS || !SUCCESSOR_PHRASE.test(text)) return null;

  const own = getDomain(originalDomain) ?? originalDomain.toLowerCase();
  let successor: string | null = null;
  $("a[href]").each((_, el) => {
    if (successor) return;
    try {
      const host = new URL($(el).attr("href") ?? "", `https://${originalDomain}/`).hostname;
      const root = getDomain(host);
      if (root && root !== own) successor = root;
    } catch {
      // not a usable link
    }
  });
  return successor;
}

// --- Contact-form detection ------------------------------------------------------
// A "contact page" link is not proof of a form — plenty of contact pages are
// just an address and a map. So look for an actual form a visitor can send a
// message through, and rule out the forms that are NOT one: site search,
// login, newsletter sign-up and the blog's comment box.
const NOT_A_CONTACT_FORM_MARKER = /search|login|signin|sign-in|log-in|register|comment|subscribe|newsletter|checkout|cart|coupon/i;
const MESSAGE_FIELD_HINT = /message|enquir|inquir|comments?|question|how can we help|your (note|request)/i;

// Form plugins that render a wrapper element the page ships with even when the
// <form> itself is filled in by JavaScript later.
const FORM_PLUGIN_WRAPPERS = [
  ".wpcf7", ".wpforms-container", ".gform_wrapper", ".fluentform", ".nf-form-cont", ".frm_forms",
  ".forminator-ui", ".elementor-form", ".jet-form-builder", ".hs-form", ".hbspt-form",
];
// Hosted forms embedded by iframe or script.
const FORM_EMBED_HOSTS =
  /hsforms|hubspot|typeform\.com|jotform|forms\.gle|docs\.google\.com\/forms|formstack|wufoo|123formbuilder|cognitoforms|tally\.so|paperform|formspree|airtable\.com\/embed|zohopublic|zfrmz|forms\.office\.com|formsite/i;

export function detectContactForm(html: string): { type: string } | null {
  const $ = cheerio.load(html);

  let found = null as { type: string } | null;
  $("form").each((_, form) => {
    if (found) return;
    const $form = $(form);
    if (($form.attr("role") ?? "").toLowerCase() === "search") return;
    if ($form.find('input[type="search"], input[type="password"]').length) return;
    const marker = `${$form.attr("id") ?? ""} ${$form.attr("class") ?? ""} ${$form.attr("action") ?? ""}`;
    if (NOT_A_CONTACT_FORM_MARKER.test(marker)) return;
    if (!$form.find('button, input[type="submit"], input[type="image"], [role="button"]').length) return;

    const hasTextarea = $form.find("textarea").length > 0;
    const hasMessageLikeField =
      $form.find("input, select").filter((_, el) => {
        const hint = `${$(el).attr("name") ?? ""} ${$(el).attr("id") ?? ""} ${$(el).attr("placeholder") ?? ""}`;
        return MESSAGE_FIELD_HINT.test(hint);
      }).length > 0;
    if (!hasTextarea && !hasMessageLikeField) return;

    const hasContactField = $form.find('input[type="email"], input[type="text"], input:not([type]), textarea').length > 0;
    if (!hasContactField) return;
    found = { type: /wpcf7/i.test(marker) ? "wpcf7" : /gform|gravity/i.test(marker) ? "gravity_forms" : "html_form" };
  });
  if (found) return found;

  if ($("iframe[src], iframe[data-src]").toArray().some((el) => FORM_EMBED_HOSTS.test($(el).attr("src") ?? $(el).attr("data-src") ?? ""))) {
    return { type: "embedded_form" };
  }
  if ($(FORM_PLUGIN_WRAPPERS.join(",")).length > 0) return { type: "form_plugin" };
  return null;
}

// Archive/taxonomy/asset URLs that merely CONTAIN the word "contact" —
// e.g. marketinghypes.com/category/contact-us/ is a blog category page, not
// a contact page, and reporting it as one gave a false "form_only".
const NOT_A_CONTACT_PAGE = /\/(category|categories|tag|tags|author|authors|feed|wp-content|wp-json)(\/|$)|\.(pdf|jpe?g|png|gif|webp|zip)$/i;
const CONTACT_SLUGS = new Set([
  "contact", "contact-us", "contactus", "contact_us", "contact-me", "get-in-touch", "reach-us", "write-to-us",
]);

// Higher = more clearly THE contact page. A link's last path segment being a
// known contact slug beats link text, which beats the word merely appearing.
function scoreContactLink(pathname: string, linkText: string): number {
  if (NOT_A_CONTACT_PAGE.test(pathname)) return 0;
  const segments = pathname.split("/").filter(Boolean);
  const last = (segments[segments.length - 1] ?? "").toLowerCase();
  const text = linkText.trim().toLowerCase().replace(/\s+/g, " ");

  if (CONTACT_SLUGS.has(last)) return segments.length === 1 ? 5 : 4;
  if (/^(contact( us)?|get in touch)$/.test(text)) return 3;
  if (last.includes("contact")) return 2;
  if (text.includes("contact")) return 1;
  return 0;
}

export function findContactPageUrl(html: string, baseUrl: string, domain: string): string | null {
  const $ = cheerio.load(html);
  const stripWww = (h: string) => h.replace(/^www\./, "");
  let best: { url: string; score: number } | null = null;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

    try {
      const abs = new URL(href, baseUrl);
      if (stripWww(abs.hostname) !== stripWww(domain)) return;
      const score = scoreContactLink(abs.pathname, $(el).text());
      if (score > 0 && (!best || score > best.score)) best = { url: abs.href, score };
    } catch {
      // ignore malformed hrefs
    }
  });

  return best ? (best as { url: string }).url : null;
}

// Pages where an address is often published even though the homepage and the
// contact page show none: About/Team, Support/Help, and legal notices (an
// Impressum/Imprint is REQUIRED to list an email in Germany and much of the
// EU). In a 30-site sample of "no contact found" results, 60% linked to one
// of these and we never opened it.
const SECONDARY_SLUGS = new Set([
  "about", "about-us", "aboutus", "about_us", "team", "our-team", "meet-the-team",
  "support", "help", "customer-service", "impressum", "imprint", "legal", "legal-notice",
  // pages that exist to be pitched — often carry the editor's/partnerships address
  "write-for-us", "writeforus", "guest-post", "guest-posts", "guest-posting", "contribute", "contributors",
  "advertise", "advertising", "advertise-with-us", "partner", "partnerships", "work-with-us", "submit-a-post",
]);

// Tried, in order, when the homepage links to no contact page at all (menus
// built by JavaScript, links inside images, footers we can't parse). Kept short:
// every guess is a real request against the site's per-host rate limit.
export const CONTACT_FALLBACK_PATHS = ["/contact", "/contact-us", "/write-for-us", "/get-in-touch"];

function scoreSecondaryLink(pathname: string, linkText: string): number {
  if (NOT_A_CONTACT_PAGE.test(pathname)) return 0;
  const segments = pathname.split("/").filter(Boolean);
  const last = (segments[segments.length - 1] ?? "").toLowerCase();
  const text = linkText.trim().toLowerCase().replace(/\s+/g, " ");

  if (SECONDARY_SLUGS.has(last)) return segments.length === 1 ? 5 : 4;
  if (/^(about( us)?|our team|meet the team|support|help( center)?|impressum|imprint|legal notice)$/.test(text)) return 3;
  return 0;
}

// Up to `max` distinct About/Support/Imprint-style pages, best-scoring first.
export function findSecondaryPageUrls(html: string, baseUrl: string, domain: string, max = 2): string[] {
  const $ = cheerio.load(html);
  const stripWww = (h: string) => h.replace(/^www\./, "");
  const scored = new Map<string, number>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

    try {
      const abs = new URL(href, baseUrl);
      if (stripWww(abs.hostname) !== stripWww(domain)) return;
      const score = scoreSecondaryLink(abs.pathname, $(el).text());
      if (score === 0) return;
      const key = abs.origin + abs.pathname; // de-dupe ?query / #fragment variants
      if (score > (scored.get(key) ?? 0)) scored.set(key, score);
    } catch {
      // ignore malformed hrefs
    }
  });

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([url]) => url);
}

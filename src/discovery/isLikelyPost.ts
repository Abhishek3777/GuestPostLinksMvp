// Sitemaps (and homepage crawls) mix real posts in with category/tag/author
// archives, the homepage itself, and static pages like /contact-us/ or
// /faq/. None of those have an "article" to extract backlinks from, so they
// shouldn't compete with real posts for a spot in the "recent posts"
// selection. This is just a cheap first pass on the URL alone — the real
// confirmation that a page is an actual post happens later, when we read the
// page itself (see articleSignal.ts), so this list doesn't need to be
// exhaustive or handle every compound slug.
const EXCLUDE_SEGMENT = new Set([
  "category",
  "categories",
  "tag",
  "tags",
  "author",
  "authors",
  "page",
  "contact",
  "contact-us",
  "about",
  "about-us",
  "privacy-policy",
  "privacy",
  "terms",
  "terms-of-service",
  "terms-of-use",
  "cookie-policy",
  "cookies",
  "faq",
  "faqs",
  "press",
  "charity",
  "help",
  "support",
  "pricing",
  "login",
  "cart",
  "checkout",
  "feed",
  "wp-content",
  "wp-admin",
  "wp-json",
]);

// Hyphens stripped so "contact-us" also matches a camelCase filename like
// "ContactUs.html" — compared against the WHOLE segment, never a substring,
// so a real post slug like "contact-lens-care-tips" or "all-about-dogs"
// still passes (it normalizes to something longer than any single entry).
const EXCLUDE_SEGMENT_NORMALIZED = new Set([...EXCLUDE_SEGMENT].map((s) => s.replace(/-/g, "")));

function normalizeSegment(segment: string): string {
  return segment
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[-_]/g, "");
}

export function isLikelyPostUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false; // homepage

  if (EXCLUDE_SEGMENT_NORMALIZED.has(normalizeSegment(segments[0]))) return false;

  // Also check the last segment (the page's actual slug/filename) with any
  // file extension stripped, so e.g. /entertainment/charity.asp is caught
  // even though "charity" isn't the first path segment.
  const last = segments[segments.length - 1].replace(/\.[a-zA-Z0-9]+$/, "");
  if (EXCLUDE_SEGMENT_NORMALIZED.has(normalizeSegment(last))) return false;

  return true;
}

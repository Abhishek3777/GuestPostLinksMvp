// Sitemaps (and homepage crawls) mix real posts in with category/tag/author
// archives, the homepage itself, and static pages like /contact-us/. None of
// those have an "article" to extract backlinks from, so they shouldn't
// compete with real posts for a spot in the "recent posts" selection.
const EXCLUDE_FIRST_SEGMENT = new Set([
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
  "terms",
  "terms-of-service",
  "feed",
  "wp-content",
  "wp-admin",
  "wp-json",
]);

export function isLikelyPostUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false; // homepage

  return !EXCLUDE_FIRST_SEGMENT.has(segments[0].toLowerCase());
}

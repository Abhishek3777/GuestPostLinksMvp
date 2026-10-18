import type { DiscoveredPost } from "../types.js";
import { isLikelyPostUrl } from "./isLikelyPost.js";
import { dateFromUrlPath } from "../extraction/articleSignal.js";

export interface RecencyOptions {
  days?: number;
  maxCount?: number;
}

// Sitemap discovery deliberately never sets publishedAt (see sitemap.ts —
// a sitemap's <lastmod> means "page last touched", not "published", so
// trusting it caused its own accuracy problems). That's still correct, but
// it left every sitemap-sourced candidate with NO date at this stage at
// all, which meant the "process newest first" sort below was a no-op for
// them — confirmed live, 2026-10-18: a domain whose sitemap listed 5,000
// candidates in no particular useful order could spend its entire time
// budget on arbitrarily-ordered posts, with no better chance of covering
// the genuinely recent ones than the genuinely ancient ones, when it ran
// out of time before finishing.
//
// dateFromUrlPath is the same already-trusted signal already used as the
// last-resort fallback for the FINAL authoritative date (articleSignal.ts) —
// this reuses it one step earlier, purely to triage which candidates are
// worth trying first and which are obviously too old to bother with at all,
// never as the final word on whether a post actually counts (that's still
// decided later, from the real page content).
function hintedDate(p: DiscoveredPost): string | null {
  return p.publishedAt ?? dateFromUrlPath(p.url);
}

// Filters + sorts candidates newest-first, but does NOT slice to maxCount —
// callers that need to backfill past non-article pages (see pipeline.ts)
// need the full ranked list to pull the next candidate from.
export function rankCandidatePosts(posts: DiscoveredPost[], opts: { days?: number }): DiscoveredPost[] {
  let filtered = posts.filter((p) => isLikelyPostUrl(p.url));

  if (opts.days) {
    const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((p) => {
      const hint = hintedDate(p);
      if (!hint) return true; // keep undated posts rather than silently drop them
      const t = new Date(hint).getTime();
      return Number.isNaN(t) || t >= cutoff;
    });
  }

  // Sort newest-first when we have dates (real or URL-hinted), undated posts
  // sink to the bottom. Hint computed once per item up front, not inside the
  // comparator — a comparator re-running dateFromUrlPath's regex on every
  // comparison would be O(n log n) regex calls instead of O(n), which matters
  // once a domain's candidate list reaches into the thousands.
  const withTime = filtered.map((p) => {
    const hint = hintedDate(p);
    return { p, t: hint ? new Date(hint).getTime() : 0 };
  });
  withTime.sort((a, b) => b.t - a.t);
  return withTime.map(({ p }) => p);
}

export function selectRecentPosts(posts: DiscoveredPost[], opts: RecencyOptions): DiscoveredPost[] {
  const ranked = rankCandidatePosts(posts, { days: opts.days });
  return opts.maxCount ? ranked.slice(0, opts.maxCount) : ranked;
}

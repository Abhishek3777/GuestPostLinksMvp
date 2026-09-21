import type { DiscoveredPost } from "../types.js";
import { isLikelyPostUrl } from "./isLikelyPost.js";

export interface RecencyOptions {
  days?: number;
  maxCount?: number;
}

// Filters + sorts candidates newest-first, but does NOT slice to maxCount —
// callers that need to backfill past non-article pages (see pipeline.ts)
// need the full ranked list to pull the next candidate from.
export function rankCandidatePosts(posts: DiscoveredPost[], opts: { days?: number }): DiscoveredPost[] {
  let filtered = posts.filter((p) => isLikelyPostUrl(p.url));

  if (opts.days) {
    const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((p) => {
      if (!p.publishedAt) return true; // keep undated posts rather than silently drop them
      const t = new Date(p.publishedAt).getTime();
      return Number.isNaN(t) || t >= cutoff;
    });
  }

  // Sort newest-first when we have dates, undated posts sink to the bottom.
  return [...filtered].sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}

export function selectRecentPosts(posts: DiscoveredPost[], opts: RecencyOptions): DiscoveredPost[] {
  const ranked = rankCandidatePosts(posts, { days: opts.days });
  return opts.maxCount ? ranked.slice(0, opts.maxCount) : ranked;
}

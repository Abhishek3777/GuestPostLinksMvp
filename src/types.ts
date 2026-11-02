export type DiscoverySource = "sitemap" | "wp-api" | "feed" | "html-crawl";

export interface DiscoveredPost {
  url: string;
  title?: string;
  // A confirmed-enough date to trust for the REAL day-window decision
  // (pipeline.ts's effectiveDate) — real metadata only (RSS <pubDate>,
  // Atom <published>, WP REST API's `date` field), or null when nothing
  // like that exists yet. NEVER set this from a "last touched"/"modified"
  // signal (a sitemap's <lastmod>, Atom's <updated>) — that exact mistake
  // let years-old posts slip through as "recent" once (regressed
  // 2026-10-24 when sitemap.ts started writing <lastmod> here, fixed
  // 2026-11-02). An ordering-only hint like that belongs in
  // sitemapLastmod below, never here.
  publishedAt?: string | null;
  // Ranking hint ONLY, for selectRecent.ts to decide what order to try
  // candidates in. A sitemap's <lastmod> reliably reflects "page last
  // touched", which is a good proxy for recency when deciding what to try
  // first, but is NOT the same thing as "when this was published" — never
  // read this as a real date anywhere outside selectRecent.ts's ordering.
  sitemapLastmod?: string | null;
}

export interface DiscoveryResult {
  domain: string;
  status: "success" | "no_posts_found" | "blocked" | "dns_error" | "timeout" | "error";
  source?: DiscoverySource;
  posts: DiscoveredPost[];
  reason?: string;
}

import { discoverPosts } from "./discovery/index.js";
import { rankCandidatePosts } from "./discovery/selectRecent.js";
import { extractLinksFromPost } from "./extraction/index.js";

export interface CrawlDomainOptions {
  days?: number;
  targetPostCount: number; // how many REAL articles we want links from
  maxAttempts?: number; // safety cap on total posts tried, default targetPostCount * 3
  // Post URLs an earlier run already finished with (monitoring runs). They are
  // not fetched again, so only NEW posts are read.
  skipPostUrls?: ReadonlySet<string>;
}

// What happened to a post this run, so it can be remembered for next time.
// "done" = read; "skipped" = fetched but not usable. A post whose fetch FAILED
// is left out on purpose so it gets retried.
export interface ProcessedPost {
  url: string;
  outcome: "done" | "skipped";
  linksFound: number;
}

export interface CrawlRow {
  guestPostUrl: string;
  externalLink: string;
  rootDomain: string;
  postDate: string | null;
}

export interface CrawlDomainResult {
  domain: string;
  discoveryStatus: string;
  discoverySource?: string;
  reason?: string; // WHY, when status isn't "success" — e.g. "homepage probe: cloudflare_challenge"
  rows: CrawlRow[];
  postsProcessed: number; // real articles successfully processed
  postsAttempted: number; // total fetch attempts, including skipped non-articles
  skipped: { url: string; reason: string; blocked?: boolean }[];
  processedPosts: ProcessedPost[];
}

export async function crawlDomain(domain: string, opts: CrawlDomainOptions): Promise<CrawlDomainResult> {
  const discovery = await discoverPosts(domain);
  if (discovery.status !== "success") {
    return {
      domain,
      discoveryStatus: discovery.status,
      reason: discovery.reason,
      rows: [],
      postsProcessed: 0,
      postsAttempted: 0,
      skipped: [],
      processedPosts: [],
    };
  }

  const candidates = rankCandidatePosts(discovery.posts, { days: opts.days }).filter(
    (p) => !opts.skipPostUrls?.has(p.url)
  );
  const maxAttempts = opts.maxAttempts ?? opts.targetPostCount * 3;

  const rows: CrawlRow[] = [];
  const skipped: { url: string; reason: string; blocked?: boolean }[] = [];
  const processedPosts: ProcessedPost[] = [];
  let processed = 0;
  let attempted = 0;

  for (const post of candidates) {
    if (processed >= opts.targetPostCount) break;
    if (attempted >= maxAttempts) break;

    attempted++;
    // No delay here: every request to a host is already spaced by the
    // per-host limiter in httpClient.ts.
    const result = await extractLinksFromPost(post.url, domain);

    if (result.status !== "success") {
      // Not a real article (too short, fetch failed, etc) — don't burn the
      // slot, just move on to the next candidate. This is the backfill.
      skipped.push({
        url: post.url,
        reason: result.detail ? `${result.status}:${result.detail}` : result.status,
        blocked: result.blocked,
      });
      if (result.status !== "fetch_failed") processedPosts.push({ url: post.url, outcome: "skipped", linksFound: 0 });
      continue;
    }

    processed++;
    processedPosts.push({ url: post.url, outcome: "done", linksFound: result.links.length });
    for (const link of result.links) {
      rows.push({
        guestPostUrl: post.url,
        externalLink: link.externalUrl,
        rootDomain: link.rootDomain,
        postDate: post.publishedAt ?? null,
      });
    }
  }

  // Discovery worked (we found post URLs) but not a single one produced an
  // article. Reporting that as a plain "success, 0 posts" hides the real
  // story — e.g. sitemap loads fine but every post page returns 403 — so
  // classify it and say why.
  if (processed === 0 && attempted > 0) {
    const PLAIN: Record<string, string> = {
      no_article_found: "no readable article body (not a blog post, or content is rendered by JavaScript)",
      too_short_not_article: "page too short to be an article",
      not_a_post_page: "WordPress page/archive rather than a post",
      link_farm: "link directory / roundup page (too many outbound links to be an article)",
    };
    const breakdown = new Map<string, number>();
    for (const s of skipped) {
      const label = PLAIN[s.reason] ?? s.reason;
      breakdown.set(label, (breakdown.get(label) ?? 0) + 1);
    }
    const summary = [...breakdown.entries()].map(([r, n]) => `${r} x${n}`).join(", ");
    const allBlocked = skipped.length > 0 && skipped.every((s) => s.blocked);

    return {
      domain,
      discoveryStatus: allBlocked ? "blocked" : "no_posts_found",
      discoverySource: discovery.source,
      reason: allBlocked
        ? `post pages blocked (homepage/${discovery.source} reachable): ${summary}`
        : `found ${candidates.length} candidate URLs via ${discovery.source}, none usable as articles: ${summary}`,
      rows,
      postsProcessed: 0,
      postsAttempted: attempted,
      skipped,
      processedPosts,
    };
  }

  return {
    domain,
    discoveryStatus: discovery.status,
    discoverySource: discovery.source,
    reason:
      candidates.length === 0 && opts.skipPostUrls?.size
        ? "no new posts since the last run"
        : discovery.reason,
    rows,
    postsProcessed: processed,
    postsAttempted: attempted,
    skipped,
    processedPosts,
  };
}

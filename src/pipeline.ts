import { fetchText, isHostHeavilyRateLimited, type Fetcher } from "./httpClient.js";
import { discoverPosts } from "./discovery/index.js";
import { rankCandidatePosts } from "./discovery/selectRecent.js";
import { extractLinksFromPost } from "./extraction/index.js";
import { dateFromUrlPath } from "./extraction/articleSignal.js";

// A post with no confirmable date is kept rather than rejected (we can't
// prove it's old) — but a domain whose posts are ALL undated could otherwise
// flood a large "posts per domain" setting entirely with unverifiable
// content. This caps how many undated posts count from any single domain,
// regardless of how high targetPostCount is set; dated posts are unaffected.
const MAX_UNDATED_POSTS_PER_DOMAIN = 100;

export interface CrawlDomainOptions {
  days?: number;
  targetPostCount: number; // how many REAL articles we want links from
  maxAttempts?: number; // safety cap on total posts tried, default targetPostCount * 3
  // Post URLs an earlier run already finished with (monitoring runs). They are
  // not fetched again, so only NEW posts are read.
  skipPostUrls?: ReadonlySet<string>;
  // Plain HTTP by default; a local script can pass a real-browser fetcher
  // (see contact/browserFetcher.ts) for domains that challenge plain requests.
  fetcher?: Fetcher;
  // Absolute Date.now()-style timestamp. A domain with a genuinely huge,
  // legitimate archive (confirmed live: a real site with 5,000+ real posts,
  // every one succeeding normally, zero rate-limiting) can never reach a high
  // targetPostCount within the caller's own outer hard-timeout — it was
  // always making real progress, just too much real content to finish in
  // time, and the outer timeout had no choice but to kill the whole promise
  // and record a generic "error", discarding everything already found. This
  // lets the loop see its own deadline coming and wrap up gracefully instead,
  // returning what it actually found as a real result.
  deadline?: number;
  // Lets the caller actually stop this crawl mid-flight (see util.ts's
  // withTimeout) instead of merely abandoning it to keep running orphaned —
  // confirmed live, 2026-10-18: a domain with a huge candidate list, once
  // abandoned without real cancellation, kept fetching every remaining
  // candidate in the background indefinitely, and piling up two or three
  // such orphaned crawls at once was what was actually exhausting the heap
  // and crashing the whole worker, regardless of concurrency settings.
  signal?: AbortSignal;
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
  const baseFetcher = opts.fetcher ?? fetchText;
  // Wrapped once, here, so every call this function makes through `fetcher`
  // — discovery AND every per-post extraction — automatically carries the
  // cancellation signal, without discovery/extraction needing to know about
  // it at all.
  const fetcher: Fetcher = opts.signal ? (url) => baseFetcher(url, opts.signal) : baseFetcher;
  const discovery = await discoverPosts(domain, fetcher);
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

  // targetPostCount * 3 is a reasonable budget when targetPostCount is small
  // (5-50), but at the "no limit" sentinel (1000) it becomes 3000 attempts —
  // and a domain that is never going to produce anything (dead site, every
  // candidate too old, nothing but FAQ/archive pages) burns the FULL budget
  // at ~2.5s/attempt minimum before giving up. Confirmed live: a single real
  // domain from one campaign's list ran for 35+ minutes straight with zero
  // successes before this existed. A domain that hasn't produced a single
  // real post after a fair sample isn't about to start — cut losses early.
  // A domain that HAS found even one real post keeps its full budget, since
  // it's demonstrably worth the continued time (this is what protects a
  // genuinely high-volume domain from being capped along with the dead ones).
  const EARLY_GIVE_UP_AFTER_ATTEMPTS = 50;

  const rows: CrawlRow[] = [];
  const skipped: { url: string; reason: string; blocked?: boolean }[] = [];
  const processedPosts: ProcessedPost[] = [];
  let processed = 0;
  let attempted = 0;
  let undatedProcessed = 0;
  let stoppedForRateLimit = false;
  let stoppedForDeadline = false;

  for (const post of candidates) {
    // Checked first, unconditionally (unlike the other early-exits below,
    // this one applies even when processed > 0) — a domain that's actively
    // succeeding still needs to wrap up before the caller's hard timeout
    // kills it mid-flight.
    if (opts.deadline && Date.now() >= opts.deadline) {
      stoppedForDeadline = true;
      break;
    }
    if (processed >= opts.targetPostCount) break;
    if (attempted >= maxAttempts) break;
    if (processed === 0 && attempted >= EARLY_GIVE_UP_AFTER_ATTEMPTS) break;
    // A host that's heavily rate-limiting us (its per-request gap has backed
    // off well past the normal 2.5s — see isHostHeavilyRateLimited) will only
    // get slower for every remaining candidate, not better. Grinding through
    // the rest of a 50-attempt budget at 10-20s/request is how a perfectly
    // reachable, fast site (opens instantly for a human) still blows the
    // whole-domain time cap and comes back as a generic "error" — confirmed
    // live against real production domains. Same "processed === 0" guard as
    // above: a domain that's already found real posts is worth the wait.
    if (processed === 0 && isHostHeavilyRateLimited(domain)) {
      stoppedForRateLimit = true;
      break;
    }

    attempted++;
    // No delay here: every request to a host is already spaced by the
    // per-host limiter in httpClient.ts.
    const result = await extractLinksFromPost(post.url, domain, fetcher);

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

    // The real published date read off the page itself (preferred — see
    // articleSignal.ts) beats whatever discovery guessed beforehand. This is
    // the actual, final day-window check: discovery-stage filtering only had
    // an untrustworthy guess (or nothing) to go on, so a post that looked
    // recent from its sitemap/feed entry can still turn out to be old once
    // we've read its real publish date — and vice versa. A date-based
    // permalink (/2023/11/20/slug/) is the last resort before giving up
    // entirely — confirmed live, 2026-10-13: a site with a broken theme
    // (empty <time datetime=""> tags, no JSON-LD/OG date either) let a
    // 2-year-old post slip through a 12-day campaign window as "undated"
    // before this existed. No date found anywhere (including the URL) means
    // we genuinely can't confirm either way, so it's kept rather than
    // guessed at.
    const effectiveDate = result.publishedAt ?? post.publishedAt ?? dateFromUrlPath(post.url) ?? null;
    if (opts.days && effectiveDate) {
      const t = new Date(effectiveDate).getTime();
      const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
      if (!Number.isNaN(t) && t < cutoff) {
        skipped.push({ url: post.url, reason: "too_old" });
        processedPosts.push({ url: post.url, outcome: "skipped", linksFound: 0 });
        continue;
      }
    }

    if (!effectiveDate) {
      if (undatedProcessed >= MAX_UNDATED_POSTS_PER_DOMAIN) {
        skipped.push({ url: post.url, reason: "undated_cap_reached" });
        processedPosts.push({ url: post.url, outcome: "skipped", linksFound: 0 });
        continue;
      }
      undatedProcessed++;
    }

    processed++;
    processedPosts.push({ url: post.url, outcome: "done", linksFound: result.links.length });
    for (const link of result.links) {
      rows.push({
        guestPostUrl: post.url,
        externalLink: link.externalUrl,
        rootDomain: link.rootDomain,
        postDate: effectiveDate,
      });
    }
  }

  // Discovery worked (we found post URLs) but not a single one produced an
  // article. Reporting that as a plain "success, 0 posts" hides the real
  // story — e.g. sitemap loads fine but every post page returns 403 — so
  // classify it and say why.
  if (processed === 0 && (attempted > 0 || stoppedForRateLimit || stoppedForDeadline)) {
    const PLAIN: Record<string, string> = {
      no_article_found: "no readable article body (not a blog post, or content is rendered by JavaScript)",
      too_short_not_article: "page too short to be an article",
      not_a_post_page: "WordPress page/archive rather than a post",
      no_article_signal: "no blog-post markers found (likely FAQ/contact/info page, not an article)",
      too_old: "published before the requested date window (confirmed from the post's real publish date)",
      undated_cap_reached: `already reached the ${MAX_UNDATED_POSTS_PER_DOMAIN}-undated-post safety cap for this domain (no reliable date to confirm recency)`,
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
      reason: stoppedForRateLimit
        ? `found ${candidates.length} candidate URLs via ${discovery.source}, stopped after ${attempted} of them — this host is rate-limiting us heavily (reachable, just can't be crawled at normal speed)` +
          (summary ? `: ${summary}` : "")
        : allBlocked
        ? `post pages blocked (homepage/${discovery.source} reachable): ${summary}`
        : `found ${candidates.length} candidate URLs via ${discovery.source}` +
          (attempted < candidates.length ? ` (gave up early after ${attempted} of them, none usable)` : ", none usable as articles") +
          `: ${summary}`,
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
    reason: stoppedForDeadline
      ? `found ${processed} real post(s) via ${attempted} of ${candidates.length} candidates, stopped to stay inside the time budget (likely more available: a genuinely large/active site, not a failure)` +
        (discovery.reason ? ` (${discovery.reason})` : "")
      : candidates.length === 0 && opts.skipPostUrls?.size
      ? "no new posts since the last run"
      : discovery.reason,
    rows,
    postsProcessed: processed,
    postsAttempted: attempted,
    skipped,
    processedPosts,
  };
}

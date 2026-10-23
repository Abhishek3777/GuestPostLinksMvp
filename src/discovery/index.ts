import { loadRobots } from "../robots.js";
import { fallbackDescription, fetchText, type Fetcher } from "../httpClient.js";
import type { DiscoveryResult, DiscoverySource } from "../types.js";
import { tryFetchSitemap } from "./sitemap.js";
import { tryFetchWpApi } from "./wpApi.js";
import { tryFetchFeed } from "./feed.js";
import { tryHtmlFallback } from "./htmlFallback.js";

// Typed off tryFetchWpApi (not tryFetchSitemap) since it's the one strategy
// that actually uses the trailing `days` param — a function needing fewer
// params (sitemap/feed/html-crawl) is still structurally assignable here,
// TypeScript just lets them ignore the extra optional argument.
const strategies: [DiscoverySource, typeof tryFetchWpApi][] = [
  ["sitemap", tryFetchSitemap],
  ["wp-api", tryFetchWpApi],
  ["feed", tryFetchFeed],
  ["html-crawl", tryHtmlFallback],
];

// `days`: how far back the caller actually wants posts from — only wp-api's
// pagination uses this today (to know when to stop asking for more pages);
// every other strategy ignores it and returns everything it can find, same
// as before.
export async function discoverPosts(domain: string, fetcher: Fetcher = fetchText, days?: number): Promise<DiscoveryResult> {
  // Cheap probe first: if the homepage itself is a JS-challenge / anti-bot
  // interstitial, every other path on this domain will hit the same wall.
  // Bail out immediately instead of burning 4 more requests to find that out.
  const probe = await fetcher(`https://${domain}/`);
  const probeDetail = probe.failureDetail ?? probe.errorReason ?? "unknown";

  // A 404/410 on the bare homepage doesn't mean the site is down (sitemap or
  // feed may still work), so those fall through to the strategies. Every
  // other failure — block, DNS, timeout, connection/TLS error — is terminal.
  const softFailure = probe.failureDetail === "http_404" || probe.failureDetail === "http_410";
  if (!probe.ok && probe.errorReason && !softFailure) {
    return { domain, status: probe.errorReason, posts: [], reason: `homepage probe: ${probeDetail}` };
  }

  const robots = await loadRobots(domain);

  for (const [source, strategy] of strategies) {
    const posts = await strategy(domain, robots, fetcher, days);
    if (posts && posts.length) {
      return {
        domain,
        status: "success",
        source,
        posts,
        reason: fallbackDescription(probe.usedFallback) ?? undefined,
      };
    }
  }

  return {
    domain,
    status: "no_posts_found",
    posts: [],
    reason: `reachable, but no posts found via sitemap, wp-api, feed or homepage links${probe.ok ? "" : ` (homepage: ${probeDetail})`}`,
  };
}

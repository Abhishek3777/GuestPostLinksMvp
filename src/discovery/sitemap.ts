import { XMLParser } from "fast-xml-parser";
import { fetchText, type Fetcher } from "../httpClient.js";
import type { RobotsGate } from "../robots.js";
import type { DiscoveredPost } from "../types.js";

const parser = new XMLParser({ ignoreAttributes: false });
const MAX_SUB_SITEMAPS = 5;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// <lastmod> used to be discarded entirely here ("page last touched, not
// originally published" — a real risk for a page edited long after it was
// first written). Reintroduced 2026-10-24, but only as a ranking HINT, same
// role dateFromUrlPath already plays in selectRecent.ts — never the final
// accepted date, which still only ever comes from actually reading the real
// page later. Confirmed live against several real domains that day:
// <lastmod> matched the true publish timestamp to the second whenever it
// was checkable, and this is the same signal Google/Bing's own crawlers
// prioritize re-crawling by. The asymmetry that makes this safe: using it to
// decide WHAT ORDER to try candidates in can only help — worst case is the
// same as before (an arbitrary try order) — it can never cause a wrong date
// to be reported, since the real page is still what's actually trusted.
async function parseUrlset(xml: string): Promise<DiscoveredPost[]> {
  const parsed = parser.parse(xml);
  const entries = asArray<any>(parsed?.urlset?.url);
  return entries
    .map((e) => ({ url: e.loc, publishedAt: typeof e.lastmod === "string" ? e.lastmod : null }))
    .filter((p) => typeof p.url === "string") as DiscoveredPost[];
}

interface SubSitemap {
  url: string;
  lastmod: string | null;
}

function extractSubSitemaps(xml: string): SubSitemap[] {
  const parsed = parser.parse(xml);
  const entries = asArray<any>(parsed?.sitemapindex?.sitemap);
  return entries
    .map((e) => ({ url: e.loc, lastmod: typeof e.lastmod === "string" ? e.lastmod : null }))
    .filter((e): e is SubSitemap => typeof e.url === "string");
}

export async function tryFetchSitemap(
  domain: string,
  robots: RobotsGate,
  fetcher: Fetcher = fetchText,
  days?: number
): Promise<DiscoveredPost[] | null> {
  const candidates = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;

  for (const candidate of candidates) {
    if (!robots.isAllowed(candidate)) continue;

    const res = await fetcher(candidate);
    if (!res.ok || !res.body) continue;

    const body = res.body.trim();
    if (!body.startsWith("<?xml") && !body.startsWith("<urlset") && !body.startsWith("<sitemapindex")) {
      continue; // not actually a sitemap (some sites 200 a fallback HTML page)
    }

    if (body.includes("<sitemapindex")) {
      const subSitemaps = extractSubSitemaps(body);
      // A sub-sitemap whose OWN lastmod is clearly older than our window
      // cannot contain anything newer than that — safe to skip fetching it
      // at all (confirmed live, 2026-10-24: a real domain's older
      // post-sitemap file was stamped months back while its current one was
      // stamped same-day). Only skip when lastmod actually parses; one
      // that's missing or unparseable is kept rather than guessed away.
      const relevant = subSitemaps.filter((s) => {
        if (!cutoff || !s.lastmod) return true;
        const t = new Date(s.lastmod).getTime();
        return Number.isNaN(t) || t >= cutoff;
      });
      // Prefer sitemaps that look post/blog related; fall back to the first few.
      const prioritized = relevant
        .filter((s) => /post|blog|article/i.test(s.url))
        .concat(relevant.filter((s) => !/post|blog|article/i.test(s.url)))
        .slice(0, MAX_SUB_SITEMAPS);

      const posts: DiscoveredPost[] = [];
      for (const sub of prioritized) {
        if (!robots.isAllowed(sub.url)) continue;
        const subRes = await fetcher(sub.url);
        if (!subRes.ok || !subRes.body) continue;
        posts.push(...(await parseUrlset(subRes.body)));
      }
      if (posts.length) return posts;
      continue;
    }

    const posts = await parseUrlset(body);
    if (posts.length) return posts;
  }

  return null;
}

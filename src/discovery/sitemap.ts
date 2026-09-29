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

async function parseUrlset(xml: string): Promise<DiscoveredPost[]> {
  const parsed = parser.parse(xml);
  const entries = asArray<any>(parsed?.urlset?.url);
  return entries
    .map((e) => ({ url: e.loc, publishedAt: e.lastmod ?? null }))
    .filter((p) => typeof p.url === "string") as DiscoveredPost[];
}

function extractSubSitemaps(xml: string): string[] {
  const parsed = parser.parse(xml);
  const entries = asArray<any>(parsed?.sitemapindex?.sitemap);
  return entries.map((e) => e.loc).filter((u): u is string => typeof u === "string");
}

export async function tryFetchSitemap(
  domain: string,
  robots: RobotsGate,
  fetcher: Fetcher = fetchText
): Promise<DiscoveredPost[] | null> {
  const candidates = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];

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
      // Prefer sitemaps that look post/blog related; fall back to the first few.
      const prioritized = subSitemaps
        .filter((u) => /post|blog|article/i.test(u))
        .concat(subSitemaps.filter((u) => !/post|blog|article/i.test(u)))
        .slice(0, MAX_SUB_SITEMAPS);

      const posts: DiscoveredPost[] = [];
      for (const subUrl of prioritized) {
        if (!robots.isAllowed(subUrl)) continue;
        const subRes = await fetcher(subUrl);
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

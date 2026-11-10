import { XMLParser } from "fast-xml-parser";
import { fetchText, type Fetcher } from "../httpClient.js";
import type { RobotsGate } from "../robots.js";
import type { DiscoveredPost } from "../types.js";

// fast-xml-parser's processEntities.maxTotalExpansions defaults to 1000 — a
// flat count of every &amp;/&#8217;-style substitution in the whole document,
// meant to guard against a "billion laughs" entity bomb. Confirmed live,
// 2026-11-09: a large, entirely legitimate feed (totalhealth.co.uk) threw
// "Entity expansion limit exceeded: 1132 > 1000" just from ordinary
// ampersands/smart-quotes across its real articles, well under what an
// actual bomb would hit. The real defense against exponential nested-entity
// bombs is maxExpansionDepth/maxEntitySize below, left at their strict
// defaults — only the flat total-count ceiling needed raising.
const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: { maxTotalExpansions: 50_000, maxExpandedLength: 2_000_000 },
});
const FEED_PATHS = ["/feed", "/feed/", "/rss.xml", "/atom.xml", "/blog/feed"];

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseRssOrAtom(xml: string): DiscoveredPost[] {
  const parsed = parser.parse(xml);

  const rssItems = asArray<any>(parsed?.rss?.channel?.item);
  if (rssItems.length) {
    return rssItems
      .map((item) => ({
        url: item.link,
        title: item.title,
        publishedAt: item.pubDate ?? null,
      }))
      .filter((p) => typeof p.url === "string") as DiscoveredPost[];
  }

  const atomEntries = asArray<any>(parsed?.feed?.entry);
  if (atomEntries.length) {
    return atomEntries
      .map((entry) => {
        const link = Array.isArray(entry.link)
          ? entry.link.find((l: any) => l["@_rel"] !== "self")?.["@_href"] ?? entry.link[0]?.["@_href"]
          : entry.link?.["@_href"];
        // <published> is the real publish date; <updated> means "last
        // touched" (Atom requires it on every entry, even for pure edits),
        // so it's not used as a stand-in when <published> is missing.
        return {
          url: link,
          title: entry.title,
          publishedAt: entry.published ?? null,
        };
      })
      .filter((p) => typeof p.url === "string") as DiscoveredPost[];
  }

  return [];
}

export async function tryFetchFeed(
  domain: string,
  robots: RobotsGate,
  fetcher: Fetcher = fetchText
): Promise<DiscoveredPost[] | null> {
  for (const path of FEED_PATHS) {
    const url = `https://${domain}${path}`;
    if (!robots.isAllowed(url)) continue;

    const res = await fetcher(url);
    if (!res.ok || !res.body) continue;

    const body = res.body.trim();
    if (!body.startsWith("<?xml") && !body.startsWith("<rss") && !body.startsWith("<feed")) {
      continue;
    }

    const posts = parseRssOrAtom(body);
    if (posts.length) return posts;
  }

  return null;
}

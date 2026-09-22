import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../httpClient.js";
import type { RobotsGate } from "../robots.js";
import type { DiscoveredPost } from "../types.js";

const parser = new XMLParser({ ignoreAttributes: false });
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
        return {
          url: link,
          title: entry.title,
          publishedAt: entry.updated ?? entry.published ?? null,
        };
      })
      .filter((p) => typeof p.url === "string") as DiscoveredPost[];
  }

  return [];
}

export async function tryFetchFeed(
  domain: string,
  robots: RobotsGate
): Promise<DiscoveredPost[] | null> {
  for (const path of FEED_PATHS) {
    const url = `https://${domain}${path}`;
    if (!robots.isAllowed(url)) continue;

    const res = await fetchText(url);
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

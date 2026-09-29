import * as cheerio from "cheerio";
import { fetchText, type Fetcher } from "../httpClient.js";
import type { RobotsGate } from "../robots.js";
import type { DiscoveredPost } from "../types.js";

const MAX_LINKS = 30;
const EXCLUDE_PATTERN = /\/(tag|category|categories|author|page|feed|wp-content|wp-admin|wp-json)\//i;

export async function tryHtmlFallback(
  domain: string,
  robots: RobotsGate,
  fetcher: Fetcher = fetchText
): Promise<DiscoveredPost[] | null> {
  const homepageUrl = `https://${domain}/`;
  if (!robots.isAllowed(homepageUrl)) return null;

  const res = await fetcher(homepageUrl);
  if (!res.ok || !res.body) return null;

  const $ = cheerio.load(res.body);
  const seen = new Set<string>();
  const posts: DiscoveredPost[] = [];

  $("a[href]").each((_, el) => {
    if (posts.length >= MAX_LINKS) return;

    const href = $(el).attr("href");
    if (!href) return;

    let absolute: URL;
    try {
      absolute = new URL(href, homepageUrl);
    } catch {
      return;
    }

    if (absolute.hostname.replace(/^www\./, "") !== domain.replace(/^www\./, "")) return;
    if (EXCLUDE_PATTERN.test(absolute.pathname)) return;

    // Heuristic: a post URL usually has a meaningful path, not just "/"
    const segments = absolute.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return;

    const clean = absolute.origin + absolute.pathname;
    if (seen.has(clean)) return;
    seen.add(clean);
    posts.push({ url: clean });
  });

  return posts.length ? posts : null;
}

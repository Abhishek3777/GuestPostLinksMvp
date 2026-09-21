import { fetchText } from "../httpClient.js";
import type { RobotsGate } from "../robots.js";
import type { DiscoveredPost } from "../types.js";

export async function tryFetchWpApi(
  domain: string,
  robots: RobotsGate
): Promise<DiscoveredPost[] | null> {
  const url = `https://${domain}/wp-json/wp/v2/posts?per_page=20&_fields=link,date,title`;
  if (!robots.isAllowed(url)) return null;

  const res = await fetchText(url);
  if (!res.ok || !res.body) return null;

  let data: any;
  try {
    data = JSON.parse(res.body);
  } catch {
    return null; // not actually WordPress / not JSON
  }

  if (!Array.isArray(data) || data.length === 0) return null;

  const posts = data
    .map((p) => ({
      url: p.link,
      title: p.title?.rendered,
      publishedAt: p.date ?? null,
    }))
    .filter((p): p is DiscoveredPost => typeof p.url === "string");

  return posts.length ? posts : null;
}

import { fetchText, type Fetcher } from "../httpClient.js";
import type { RobotsGate } from "../robots.js";
import type { DiscoveredPost } from "../types.js";

const PER_PAGE = 20;
// A single unpaginated page was always exactly 20 posts, full stop, no
// matter how wide the requested date window was — confirmed live, 2026-10-22:
// a high-volume site (several posts/day) still came back with exactly 20
// posts for both a 10-day and a 21-day window, because discovery itself
// handed over at most 20 candidates before date filtering ever ran.
//
// A flat page-count cap isn't enough either — confirmed live the same day:
// atoallinks.com publishes roughly one post every 5-15 minutes (not per day),
// so even 200 posts (10 pages) only covered about a day of real content,
// nowhere near a 21-day window. So this now keeps paginating until it
// actually reaches posts older than the requested window (when `days` is
// given), with MAX_PAGES only as a hard safety ceiling for a pathological
// case (bad/missing dates, or no `days` given at all) — not the normal
// stopping condition anymore.
const MAX_PAGES = 50;

export async function tryFetchWpApi(
  domain: string,
  robots: RobotsGate,
  fetcher: Fetcher = fetchText,
  days?: number
): Promise<DiscoveredPost[] | null> {
  const posts: DiscoveredPost[] = [];
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${domain}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&_fields=link,date,title`;
    if (!robots.isAllowed(url)) break;

    const res = await fetcher(url);
    // Page 1 failing means "not WordPress / unreachable" — null, as before.
    // A later page failing (WP returns 400 rest_post_invalid_page_number
    // once you're past the last page) just means "no more pages" — stop
    // and keep whatever was already collected, not a failure of the whole call.
    if (!res.ok || !res.body) {
      if (page === 1) return null;
      break;
    }

    let data: any;
    try {
      data = JSON.parse(res.body);
    } catch {
      if (page === 1) return null; // not actually WordPress / not JSON
      break;
    }
    if (!Array.isArray(data) || data.length === 0) break;

    posts.push(
      ...data
        .map((p) => ({ url: p.link, title: p.title?.rendered, publishedAt: p.date ?? null }))
        .filter((p) => typeof p.url === "string")
    );

    if (data.length < PER_PAGE) break; // last page was partial — nothing more to fetch

    // WP orders newest-first, so the last item on the page is the oldest one
    // fetched so far — once THAT is already past the window, every
    // subsequent page can only be older still. No real date on it (missing/
    // unparseable) means keep going rather than risk stopping too early.
    if (cutoff) {
      const oldestOnPage = data[data.length - 1]?.date ? new Date(data[data.length - 1].date).getTime() : NaN;
      if (!Number.isNaN(oldestOnPage) && oldestOnPage < cutoff) break;
    }
  }

  return posts.length ? posts : null;
}

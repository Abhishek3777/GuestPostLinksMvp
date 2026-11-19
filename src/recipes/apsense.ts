import * as cheerio from "cheerio";
import type { DiscoveredPost } from "../types.js";
import { makePlainCurlFetcher } from "./plainCurl.js";
import { wantMore, type Recipe } from "./types.js";

const MAX_PAGES = 80;

// apsense.com's sitemap is stale and its homepage links are only menus, but
// /articles?page=N lists every new article newest first, with the date.
// The site (Cloudflare) challenges the standard browser-style request, so both
// the listing pages and the article pages are fetched with a plain curl.
export const apsense: Recipe = async (ctx) => {
  const fetchPlain = makePlainCurlFetcher({ gapMs: 800, pauseOnBlockMs: 60_000 });
  const cutoff = ctx.days ? Date.now() - ctx.days * 86_400_000 : null;
  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (!wantMore(ctx, seen)) break;
    const res = await fetchPlain(`https://www.apsense.com/articles?page=${page}`, ctx.signal);
    if (!res.ok || !res.body) {
      if (page === 1) return null;
      break;
    }
    const $ = cheerio.load(res.body);
    let found = 0;
    let oldest = Number.NaN;
    $("article").each((_, el) => {
      const href = $(el).find('h2 a[href^="/article/"]').attr("href") ?? $(el).find('a[href^="/article/"]').first().attr("href");
      if (!href) return;
      const url = new URL(href, "https://www.apsense.com").href.split(/[?#]/)[0];
      if (seen.has(url)) return;
      // The card's spans are: separator dot, date ("November 17, 2026"), separator, likes, comments.
      const dateText = $(el)
        .find(".text-muted.small span")
        .map((_, sp) => $(sp).text().trim())
        .get()
        .find((txt) => /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(txt));
      const t = dateText ? Date.parse(`${dateText} 00:00:00 UTC`) : Number.NaN;
      seen.add(url);
      found++;
      posts.push({ url, publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString() });
      if (!Number.isNaN(t) && (Number.isNaN(oldest) || t < oldest)) oldest = t;
    });
    if (found === 0) break; // past the last page
    if (cutoff && !Number.isNaN(oldest) && oldest < cutoff) break; // everything further is older than the window
  }

  if (!posts.length) return null;
  return { posts, source: "html-crawl", note: "read from the /articles listing pages (newest first)", fetchPost: fetchPlain };
};

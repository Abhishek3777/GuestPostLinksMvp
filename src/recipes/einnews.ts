import * as cheerio from "cheerio";
import type { DiscoveredPost } from "../types.js";
import { wantMore, type Recipe } from "./types.js";

const SITE = "einpresswire.com";
const MAX_PAGES = 1800;

// einnews.com's own homepage is a Cloudflare-protected news aggregator with no
// press releases on it. The releases live on its sister site einpresswire.com,
// and /all-press-releases?page=N lists every release newest first (20 a page)
// with the date. The releases are read as einpresswire.com pages, so links
// back to einpresswire.com count as internal, not as backlinks (siteDomain).
export const einnews: Recipe = async (ctx) => {
  const cutoff = ctx.days ? Date.now() - ctx.days * 86_400_000 : null;
  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (!wantMore(ctx, seen)) break;
    let res = await ctx.fetcher(`https://www.${SITE}/all-press-releases?page=${page}`);
    if (!res.ok || !res.body) {
      if (page === 1) return null;
      // one slow retry mid-way, then keep what was collected so far
      await new Promise((r) => setTimeout(r, 20_000));
      res = await ctx.fetcher(`https://www.${SITE}/all-press-releases?page=${page}`);
      if (!res.ok || !res.body) break;
    }
    const $ = cheerio.load(res.body);
    let found = 0;
    let oldest = Number.NaN;
    $("ul.pr-feed li").each((_, li) => {
      const href = $(li).find("h3 a").first().attr("href");
      if (!href || !/\/article\/\d+\//.test(href)) return;
      const url = new URL(href, `https://www.${SITE}`).href;
      if (seen.has(url)) return;
      const t = Date.parse(`${$(li).find(".pretitle .date a").first().text().trim()} 00:00:00 UTC`);
      seen.add(url);
      found++;
      posts.push({ url, publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString() });
      if (!Number.isNaN(t) && (Number.isNaN(oldest) || t < oldest)) oldest = t;
    });
    if (found === 0) break;
    if (cutoff && !Number.isNaN(oldest) && oldest < cutoff) break;
  }

  if (!posts.length) return null;
  return { posts, source: "html-crawl", note: "read from einpresswire.com/all-press-releases (newest first)", siteDomain: SITE };
};

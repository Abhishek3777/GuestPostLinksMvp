import { XMLParser } from "fast-xml-parser";
import { loadRobots } from "../robots.js";
import type { DiscoveredPost } from "../types.js";
import { wantMore, type Recipe } from "./types.js";

const parser = new XMLParser({ ignoreAttributes: false, processEntities: { maxTotalExpansions: 50_000, maxExpandedLength: 2_000_000 } });
const asArray = <T>(v: T | T[] | undefined): T[] => (v ? (Array.isArray(v) ? v : [v]) : []);
const MAX_FILES = 14;
const QUIET_FILES_BEFORE_STOP = 3;

// azbigmedia.com has a sitemap index with 64 post files (1,000 posts each),
// and the newest posts are in the highest-numbered ones. The normal sitemap
// path reads the first few, which hold 2017 to 2023 posts. Its WordPress API
// is blocked by the site's robots.txt (any address with a "?"), so the
// sitemap is the way in: read the post files from the last one backwards and
// keep entries edited inside the window, stopping once several files in a row
// have none.
export const azbigmedia: Recipe = async (ctx) => {
  const robots = await loadRobots(ctx.domain);
  const indexUrl = `https://${ctx.domain}/sitemap.xml`;
  if (!robots.isAllowed(indexUrl)) return null;
  const index = await ctx.fetcher(indexUrl);
  if (!index.ok || !index.body || !index.body.includes("<sitemapindex")) return null;

  const files = asArray<any>(parser.parse(index.body)?.sitemapindex?.sitemap)
    .map((e) => String(e.loc ?? ""))
    .map((url) => ({ url, n: Number(/post-sitemap(\d*)\.xml$/.exec(url)?.[1] || 1), isPost: /\/post-sitemap\d*\.xml$/.test(url) }))
    .filter((f) => f.isPost)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_FILES);
  if (!files.length) return null;

  const cutoff = ctx.days ? Date.now() - ctx.days * 86_400_000 : null;
  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();
  let quiet = 0;

  for (const file of files) {
    if (!wantMore(ctx, seen) || quiet >= QUIET_FILES_BEFORE_STOP) break;
    if (!robots.isAllowed(file.url)) continue;
    const res = await ctx.fetcher(file.url);
    if (!res.ok || !res.body) continue;
    let added = 0;
    for (const e of asArray<any>(parser.parse(res.body)?.urlset?.url)) {
      if (typeof e.loc !== "string" || seen.has(e.loc)) continue;
      const lastmod = typeof e.lastmod === "string" ? e.lastmod : null;
      const t = lastmod ? new Date(lastmod).getTime() : NaN;
      if (cutoff && !Number.isNaN(t) && t < cutoff) continue;
      seen.add(e.loc);
      // sitemapLastmod is a ranking hint only; publishedAt stays empty so the
      // real date is read from the page, as for every sitemap source.
      posts.push({ url: e.loc, publishedAt: null, sitemapLastmod: lastmod } as DiscoveredPost);
      added++;
    }
    quiet = added === 0 ? quiet + 1 : 0;
  }

  if (!posts.length) return null;
  return { posts, source: "sitemap", note: "read from the newest post sitemap files (newest first)" };
};

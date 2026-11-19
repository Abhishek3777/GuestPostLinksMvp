import { loadRobots } from "../robots.js";
import type { DiscoveredPost } from "../types.js";
import { wantMore, type Recipe, type RecipeResult } from "./types.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const POST_RE = /href="(https:\/\/www\.issuewire\.com\/[a-z0-9-]+-\d{15,})"/g;
const grab = (html: string) => [...html.matchAll(POST_RE)].map((m) => m[1]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function finish(posts: DiscoveredPost[]): RecipeResult | null {
  if (!posts.length) return null;
  return { posts, source: "html-crawl", note: "read from the newsroom's per-day listings (newest first)" };
}

// issuewire.com's press releases are not in its sitemap or feed. The
// newsroom lists them per day (/newsroom/filter_date?date=YYYY-MM-DD), 10 at
// a time, and loads the rest with the same "load more" call its own button
// makes. Those two addresses are not blocked in the site's robots.txt.
export const issuewire: Recipe = async (ctx) => {
  const robots = await loadRobots(ctx.domain);
  const days = ctx.days ?? 30;
  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();
  const moreUrl = "https://www.issuewire.com/newsroom/load_more/";

  for (let d = 0; d <= days; d++) {
    if (!wantMore(ctx, seen)) break;
    const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const listUrl = `https://www.issuewire.com/newsroom/filter_date?date=${day}`;
    if (!robots.isAllowed(listUrl)) return d === 0 ? null : finish(posts);

    const first = await ctx.fetcher(listUrl);
    if (!first.ok || !first.body) {
      if (d === 0) return null;
      continue;
    }
    const total = Number(/id="more" data-count="(\d+)"/.exec(first.body)?.[1] ?? 0);
    let found = grab(first.body);

    if (robots.isAllowed(moreUrl)) {
      for (let off = 10; off < total; off += 10) {
        if (ctx.signal?.aborted || (ctx.deadline && Date.now() >= ctx.deadline)) break;
        await sleep(700);
        try {
          const timeout = AbortSignal.timeout(30_000);
          const r = await fetch(moreUrl, {
            method: "POST",
            headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ date: `${day} 00:00:00`, offset: String(off) }).toString(),
            signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
          });
          if (!r.ok) break;
          found = found.concat(grab(await r.text()));
        } catch {
          break; // keep what this day already gave
        }
      }
    }

    for (const url of found) {
      if (seen.has(url)) continue;
      seen.add(url);
      posts.push({ url, publishedAt: `${day}T00:00:00.000Z` });
    }
  }
  return finish(posts);
};

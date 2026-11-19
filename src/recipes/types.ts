import type { Fetcher } from "../httpClient.js";
import type { DiscoveredPost, DiscoverySource } from "../types.js";

// What a recipe is given. These mirror what the normal crawl already knows:
// the campaign's day window, how many real posts it wants, and the same
// fetcher (rate limit + cancel signal) every other request goes through.
export interface RecipeContext {
  domain: string;
  days?: number;
  targetPostCount: number;
  fetcher: Fetcher;
  signal?: AbortSignal;
  deadline?: number;
  skipPostUrls?: ReadonlySet<string>;
}

// A recipe only does DISCOVERY: it finds the post URLs (with real dates when
// the site shows them). Reading each post, the day-window check, the attempt
// limits, the time budget and saving all stay in the normal pipeline, so a
// recipe domain is processed exactly like any other domain from there on.
export interface RecipeResult {
  posts: DiscoveredPost[];
  // Must be one of the existing sources (the database stores it as an enum).
  source: DiscoverySource;
  note: string;
  // Optional: how this site's article pages should be fetched, when the
  // standard fetcher is turned away (the pipeline uses it for every post).
  fetchPost?: Fetcher;
  // Optional: the site the posts are actually on, when it differs from the
  // campaign domain (einnews.com -> einpresswire.com). Used to tell a post's
  // own internal links apart from real backlinks.
  siteDomain?: string;
}

export type Recipe = (ctx: RecipeContext) => Promise<RecipeResult | null>;

// Candidates beyond the target are needed because some pages get skipped as
// non-articles; the pipeline allows 3x the target in attempts, so 2x here.
export function wantMore(ctx: RecipeContext, collected: Iterable<string>): boolean {
  if (ctx.signal?.aborted) return false;
  if (ctx.deadline && Date.now() >= ctx.deadline) return false;
  let fresh = 0;
  for (const u of collected) if (!ctx.skipPostUrls?.has(u)) fresh++;
  return fresh < ctx.targetPostCount * 2;
}

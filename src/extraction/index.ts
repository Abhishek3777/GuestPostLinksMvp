import { fetchText } from "../httpClient.js";
import { extractArticle } from "./article.js";
import { extractExternalLinks, type ExtractedLink } from "./links.js";
import { classifyWordPressPageType } from "./pageType.js";
import { exclusionReason } from "../filter/exclusions.js";

// Fallback for non-WordPress sites where classifyWordPressPageType can't
// tell us anything (returns "unknown"). Below this, extracted "text" is
// almost never a real written article.
const MIN_ARTICLE_TEXT_LENGTH = 500;

// A post with more outbound links than this (after the exclusion rules) is treated
// as a link farm, not an article.
export const MAX_REAL_LINKS_PER_POST = 20;
const NO_DNC = new Set<string>();

// How many of a post's outbound links would actually survive the Stage 2
// exclusion rules (so social/brand links, which are dropped anyway, do not count).
export function countRealLinks(links: ExtractedLink[]): number {
  return links.filter((l) => !exclusionReason(l.rootDomain, NO_DNC)).length;
}

export interface PostExtractionResult {
  postUrl: string;
  status:
    | "success"
    | "fetch_failed"
    | "no_article_found"
    | "too_short_not_article"
    | "not_a_post_page"
    | "link_farm";
  links: ExtractedLink[];
  detail?: string; // e.g. the exact HTTP status / anti-bot pattern when a fetch failed
  blocked?: boolean; // the failure was an active refusal, not "page missing"
}

export async function extractLinksFromPost(
  postUrl: string,
  domain: string
): Promise<PostExtractionResult> {
  const res = await fetchText(postUrl);
  if (!res.ok || !res.body) {
    return {
      postUrl,
      status: "fetch_failed",
      links: [],
      detail: res.failureDetail,
      blocked: res.errorReason === "blocked",
    };
  }

  const pageType = classifyWordPressPageType(res.body);
  if (pageType === "archive" || pageType === "page") {
    return { postUrl, status: "not_a_post_page", links: [] };
  }

  const parsed = extractArticle(res.body, postUrl);
  if (!parsed) {
    return { postUrl, status: "no_article_found", links: [] };
  }
  if (parsed.textLength < MIN_ARTICLE_TEXT_LENGTH) {
    return { postUrl, status: "too_short_not_article", links: [] };
  }

  const links = extractExternalLinks(parsed.contentHtml, postUrl, domain);

  // Link-farm guard. A real article carries a handful of outbound links; a page
  // with dozens is a link directory or roundup, and every one of its "backlinks"
  // would become a junk prospect. Only links that would actually SURVIVE the
  // Stage 2 filter count, so an article with a lot of social/brand links (which
  // are dropped anyway) is not penalised. Skip the whole post rather than keep a
  // truncated slice of the same junk.
  const realLinkCount = countRealLinks(links);
  if (realLinkCount > MAX_REAL_LINKS_PER_POST) {
    return { postUrl, status: "link_farm", links: [], detail: `${realLinkCount} outbound links` };
  }
  return { postUrl, status: "success", links };
}

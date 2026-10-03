// Confirms a page is genuinely a blog post/article, for sites where the
// WordPress body-class check (classifyWordPressPageType) can't tell us
// anything (returns "unknown"), and — for every site, WordPress included —
// pulls out the page's real PUBLISHED date while we're at it.
//
// Real posts almost always carry one of these standard "this is an Article,
// published on [date]" markers — sites add them so Google/social previews
// can show the content as an article. Plain informational pages (FAQ,
// contact, charity, etc.) are built from regular-page templates and
// essentially never carry them, which is what makes this a reliable
// post/non-post signal instead of a loose text-length guess.
//
// This is also the one reliable source of a genuine PUBLISHED date (as
// opposed to a sitemap's "last touched" date or a feed's "last updated"
// date) — these markers specifically label the publish date, not an edit
// date, so whatever they report is used as-is.

const ARTICLE_TYPES = new Set(["article", "blogposting", "newsarticle"]);

export interface ArticleDetection {
  isArticle: boolean;
  publishedAt: string | null;
}

function metaContent(html: string, property: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (new RegExp(`(?:property|name)=["']${property}["']`, "i").test(tag)) {
      const m = tag.match(/content=["']([^"']*)["']/i);
      if (m) return m[1];
    }
  }
  return null;
}

function articleDateFromJsonLd(html: string): string | null {
  for (const [, raw] of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue; // malformed JSON-LD — just means this signal isn't usable here
    }

    const top = Array.isArray(data) ? data : [data];
    const graph = top.flatMap((n: any) => (Array.isArray(n?.["@graph"]) ? n["@graph"] : []));
    for (const node of [...top, ...graph]) {
      const type = (node as any)?.["@type"];
      const types = (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === "string");
      const datePublished = (node as any)?.datePublished;
      if (types.some((t) => ARTICLE_TYPES.has(t.toLowerCase())) && datePublished) {
        return String(datePublished);
      }
    }
  }
  return null;
}

function articleDateFromOpenGraph(html: string): string | null {
  const type = metaContent(html, "og:type");
  if (type?.toLowerCase() !== "article") return null;
  return metaContent(html, "article:published_time");
}

function articleDateFromTimeTag(html: string): string | null {
  for (const [tag] of html.matchAll(/<time\b[^>]*>/gi)) {
    const isPublishMarker =
      /\bpubdate\b/i.test(tag) || /itemprop=["']datePublished["']/i.test(tag) || /property=["']datePublished["']/i.test(tag);
    if (!isPublishMarker) continue;
    const m = tag.match(/datetime=["']([^"']+)["']/i);
    if (m) return m[1];
  }
  return null;
}

export function detectArticle(html: string): ArticleDetection {
  const publishedAt = articleDateFromJsonLd(html) ?? articleDateFromOpenGraph(html) ?? articleDateFromTimeTag(html);
  return { isArticle: publishedAt !== null, publishedAt };
}

// --- Fallback confirmation, for pages with neither a WordPress label nor a
// structured-data marker above. Plenty of genuine blogs simply never
// implement either — without this fallback they'd lose ALL their real
// content, not just the junk pages this file was built to catch (confirmed
// live: luxurytravelmagazine.com, techbuzzonline.com, hope-n-life.com and
// garyshood.com all have zero structured data on perfectly real articles).
// Two more signals, used together with extraction/index.ts's own minimum
// text-length floor — neither needs a specific tag to exist.

const CONTENT_PATH_SEGMENTS = new Set([
  "blog", "blogs", "article", "articles", "post", "posts", "news", "insights", "stories", "story",
]);

function normalizeSegment(segment: string): string {
  return segment.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

// A genuine article's web address is conventionally built FROM its title
// (standard SEO practice, followed with or without any structured-data
// markup behind it) — "how-to-make-the-right-choice-when-booking-a-room",
// "3-challenges-faced-affiliate-marketers". An administrative page (FAQ,
// contact, pricing, about) has no title to build an address from, so it
// stays short and generic — "/faq", "/contact-us". This is a far more
// universal signal than any one SEO tag, since it's just a URL-writing
// convention, not a feature a CMS has to specifically implement.
export function looksLikePostUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false;

  const last = normalizeSegment(segments[segments.length - 1].replace(/\.[a-zA-Z0-9]+$/, ""));
  const words = last.split(/[-_]+/).filter(Boolean);
  const descriptiveSlug = words.length >= 2 || last.length >= 15;

  const underContentPath = segments.slice(0, -1).some((s) => CONTENT_PATH_SEGMENTS.has(normalizeSegment(s)));

  return descriptiveSlug || underContentPath;
}

// A real article's markup usually signals itself even without formal SEO
// metadata — wrapped in a semantic <article> tag, or carrying a byline. An
// administrative page essentially never has either.
export function hasArticleHtmlHints(html: string): boolean {
  if (/<article[\s>]/i.test(html)) return true;
  if (/rel=["']author["']/i.test(html)) return true;
  if (/class=["'][^"']*\b(author|byline)\b[^"']*["']/i.test(html)) return true;
  return false;
}

import * as cheerio from "cheerio";

export interface ExtractedLink {
  externalUrl: string;
  rootDomain: string;
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

export function extractExternalLinks(
  articleHtml: string,
  postUrl: string,
  sourceDomain: string
): ExtractedLink[] {
  const $ = cheerio.load(articleHtml);
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  const source = stripWww(sourceDomain);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let absolute: URL;
    try {
      absolute = new URL(href, postUrl);
    } catch {
      return;
    }

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;

    const rootDomain = stripWww(absolute.hostname);
    if (rootDomain === source) return; // internal link, not a backlink

    const normalized = absolute.origin + absolute.pathname + absolute.search;
    if (seen.has(normalized)) return;
    seen.add(normalized);

    links.push({ externalUrl: normalized, rootDomain });
  });

  return links;
}

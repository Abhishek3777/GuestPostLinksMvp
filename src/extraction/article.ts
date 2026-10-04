import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ParsedArticle {
  contentHtml: string;
  textLength: number;
}

// Without this, JSDOM's default virtual console mirrors its own internal
// warnings/errors straight to the real console — most commonly "could not
// parse CSS stylesheet" on real-world pages with messy theme CSS, which
// dumps the ENTIRE offending stylesheet as log output. This bypasses the
// try/catch below entirely (it's not a thrown exception), sits directly in
// the hot crawl loop for every affected page, and was severe enough to
// flood Railway's logs and trip its rate limiter (confirmed live:
// "Messages dropped: 581"). Extraction correctness is unaffected either way
// — this only silences jsdom's own internal chatter, not our error handling.
const silentVirtualConsole = new VirtualConsole();

export function extractArticle(html: string, url: string): ParsedArticle | null {
  try {
    const dom = new JSDOM(html, { url, virtualConsole: silentVirtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article?.content) return null;
    return { contentHtml: article.content, textLength: article.textContent?.length ?? 0 };
  } catch {
    return null; // malformed HTML, or Readability couldn't find an article at all
  }
}

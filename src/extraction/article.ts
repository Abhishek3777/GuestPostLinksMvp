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

// Confirmed live, 2026-10-18: a real page (mypascoconnect.co.uk) served
// 27MB of HTML for what should have been an ordinary blog post — JSDOM
// alone took 23+ SECONDS to parse it synchronously, with Readability's own
// pass on top of that never finishing. This is fully synchronous work:
// nothing can interrupt it once started, not a timeout, not an
// AbortSignal, nothing — the entire process is blocked solid for as long
// as the parse takes, which is what was actually crashing the worker, not
// a memory leak. No genuine blog post is anywhere near this size (even a
// very long-form article is typically well under 1MB of raw HTML); this
// is always a broken/bloated page (infinite comment thread, a duplicated
// template, a dumped data blob), never a real article worth the risk.
const MAX_HTML_BYTES_FOR_PARSING = 3 * 1024 * 1024; // 3MB — generous, well above any real post

export function extractArticle(html: string, url: string): ParsedArticle | null {
  if (html.length > MAX_HTML_BYTES_FOR_PARSING) return null;
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

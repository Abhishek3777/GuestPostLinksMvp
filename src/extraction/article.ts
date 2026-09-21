import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ParsedArticle {
  contentHtml: string;
  textLength: number;
}

export function extractArticle(html: string, url: string): ParsedArticle | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article?.content) return null;
    return { contentHtml: article.content, textLength: article.textContent?.length ?? 0 };
  } catch {
    return null; // malformed HTML, or Readability couldn't find an article at all
  }
}

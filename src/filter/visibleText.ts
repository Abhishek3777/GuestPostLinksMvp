// A lightweight "what would a person actually see" extraction — just enough
// to stop keyword checks from matching inside <script>/<style> blocks, raw
// base64 blobs, or framework attribute soup (e.g. a Wix component's literal
// `slots="[object object]"` attribute, or a minified JS variable named
// `theme.rtl` that happens to contain "rtp"). Deliberately NOT full
// Readability/JSDOM article extraction (src/extraction/article.ts) — that's
// built for isolating one article's body text; this just needs "the noise
// is gone" for a homepage, cheaply, with no DOM parsing cost.
export function visibleTextOf(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

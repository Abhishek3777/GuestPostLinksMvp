import type { FetchResult } from "../httpClient.js";
import { playwrightProxy, sleep } from "../util.js";

// A page fetcher that loads the page in a REAL Chromium instead of a plain HTTP
// request. Some anti-bot walls (SiteGround's "Robot Challenge", Cloudflare's
// non-interactive check) are small JavaScript programs that a real browser runs and
// passes by itself — in a test on blocked sites a browser opened 4 of 7 SiteGround sites
// that plain requests never got past.
//
// Used both by local one-off rescue scripts (rescue-domains.ts, rescue-contacts.ts,
// rescue-blocked.ts) and by the deployed worker's automatic escalation
// (src/rescueFetchers.ts), which only reaches this for a domain the plain
// HTTP client already found blocked — not the default path for every domain.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const CHALLENGE_MARKERS =
  /sgcaptcha|just a moment|checking your browser|verify(ing)? (that )?you are (a )?human|enable javascript and cookies|attention required|one moment, please|robot challenge/i;
const MIN_REAL_PAGE_TEXT = 400;

export interface BrowserFetcher {
  fetch: (url: string) => Promise<FetchResult & { bytesTransferred: number }>;
  close: () => Promise<void>;
}

// Resource types blocked outright before they're ever requested (route.abort()
// — zero bytes, not just ignored after download). We only ever read
// page.content()/innerText afterward, never look at how anything actually
// renders, and the bot-challenge scripts this exists to get past are driven
// by JS execution, not images/fonts/media — those are pure bandwidth with no
// purpose here. This is specifically what 2026-10-14's proxy-cost review
// found: a real browser loads a full page's worth of assets through a paid,
// metered residential proxy, often 10-100x heavier than the plain HTML these
// fetches actually need. Stylesheets are deliberately NOT blocked — unlike
// images/fonts/media, some anti-bot checks genuinely depend on computed CSS
// state, and CSS is small enough that blocking it isn't where the real
// savings are anyway.
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

// proxyEnvVar: which env var to read for the proxy (see util.ts's
// playwrightProxy) — local scripts want their own .env's PROXY_URL, the
// worker's automatic escalation wants the separately-scoped RESCUE_PROXY_URL.
export async function createBrowserFetcher(proxyEnvVar = "PROXY_URL"): Promise<BrowserFetcher> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed. Run:  npm i -D playwright  then  npx playwright install chromium");
  }
  const browser = await chromium.launch({ headless: true, proxy: playwrightProxy(proxyEnvVar) });

  // Unchanged below this line: the existing challenge-detection/success/
  // failure logic is deliberately left untouched, line for line — only a
  // resource filter and a passive byte counter are added alongside it,
  // neither of which affects what this function decides about a page.
  async function fetchPageInner(url: string, bytesRef: { value: number }): Promise<FetchResult> {
    await sleep(1000); // never hit a site back-to-back
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US", viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (BLOCKED_RESOURCE_TYPES.has(type)) return route.abort();
      return route.continue();
    });
    page.on("response", (response) => {
      response
        .body()
        .then((b) => (bytesRef.value += b.length))
        .catch(() => undefined); // body() can fail for aborted/redirected requests — fine to just skip counting those
    });
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Give a JavaScript challenge time to solve itself and redirect.
      await page.waitForTimeout(4000);
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);

      // The challenge redirect can still be in flight; reading the page then throws, so retry briefly.
      let html = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          html = await page.content();
          break;
        } catch {
          await page.waitForTimeout(2000);
        }
      }
      const title = await page.title().catch(() => "");
      const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).trim();
      const status = response?.status() ?? 200;

      const challenged =
        page.url().includes("sgcaptcha") || CHALLENGE_MARKERS.test(title) || (text.length < 1500 && CHALLENGE_MARKERS.test(html.slice(0, 20_000)));
      if (challenged || (!html && text.length === 0)) {
        return { ok: false, errorReason: "blocked", failureDetail: "browser_challenge", status };
      }
      if (status >= 400) {
        return { ok: false, errorReason: status === 403 || status === 429 ? "blocked" : "error", failureDetail: `http_${status}`, status };
      }
      if (text.length < MIN_REAL_PAGE_TEXT && !/mailto:|<form/i.test(html)) {
        return { ok: false, errorReason: "blocked", failureDetail: "browser_empty_page", status };
      }
      return { ok: true, status, body: html, url: page.url() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, errorReason: /timeout/i.test(message) ? "timeout" : "error", failureDetail: `browser: ${message.split("\n")[0]!.slice(0, 80)}` };
    } finally {
      await context.close();
    }
  }

  async function fetchPage(url: string): Promise<FetchResult & { bytesTransferred: number }> {
    const bytesRef = { value: 0 };
    const result = await fetchPageInner(url, bytesRef);
    return { ...result, bytesTransferred: bytesRef.value };
  }

  return { fetch: fetchPage, close: () => browser.close() };
}

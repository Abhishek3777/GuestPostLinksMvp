import type { FetchResult } from "../httpClient.js";
import { playwrightProxy, sleep } from "../util.js";

// A page fetcher that loads the page in a REAL Chromium instead of a plain HTTP
// request. Some anti-bot walls (SiteGround's "Robot Challenge", Cloudflare's
// non-interactive check) are small JavaScript programs that a real browser runs and
// passes by itself — in a test on blocked sites a browser opened 4 of 7 SiteGround sites
// that plain requests never got past.
//
// It is deliberately NOT used by the deployed worker: a browser needs a lot more memory
// than the rest of the app. It is used by the local retry script (`npm run rescue --
// file --browser`) and Playwright is a development-only dependency for that reason.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const CHALLENGE_MARKERS =
  /sgcaptcha|just a moment|checking your browser|verify(ing)? (that )?you are (a )?human|enable javascript and cookies|attention required|one moment, please|robot challenge/i;
const MIN_REAL_PAGE_TEXT = 400;

export interface BrowserFetcher {
  fetch: (url: string) => Promise<FetchResult>;
  close: () => Promise<void>;
}

export async function createBrowserFetcher(): Promise<BrowserFetcher> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed. Run:  npm i -D playwright  then  npx playwright install chromium");
  }
  // Same PROXY_URL httpClient.ts uses for plain requests — an anti-bot wall a
  // browser gets past on its own doesn't need a proxy, but sites that also rate-limit
  // by IP still benefit from spreading the rescue pass across DataImpulse's pool.
  const browser = await chromium.launch({ headless: true, proxy: playwrightProxy() });

  async function fetchPage(url: string): Promise<FetchResult> {
    await sleep(1000); // never hit a site back-to-back
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US", viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
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

  return { fetch: fetchPage, close: () => browser.close() };
}

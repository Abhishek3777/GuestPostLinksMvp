import type { FetchResult } from "../httpClient.js";
import { playwrightProxy, sleep } from "../util.js";

// Same real-browser approach as browserFetcher.ts, plus one extra step: if the
// page presents an actual Cloudflare Turnstile widget (not just a "wait for the
// JS to finish" interstitial, which browserFetcher already clears for free),
// this pays CapSolver a fraction of a cent to solve it and injects the token
// itself. Only worth reaching for on the domains that are STILL blocked after
// the plain browser attempt — most blocks aren't a solvable captcha at all
// (a flat 403, a WAF rule, a proprietary challenge CapSolver doesn't support),
// and this does nothing for those.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const CHALLENGE_MARKERS =
  /sgcaptcha|just a moment|checking your browser|verify(ing)? (that )?you are (a )?human|enable javascript and cookies|attention required|one moment, please|robot challenge/i;
const MIN_REAL_PAGE_TEXT = 400;
const CAPSOLVER_API = "https://api.capsolver.com";

export interface CapsolverFetcher {
  fetch: (url: string) => Promise<FetchResult>;
  close: () => Promise<void>;
}

async function solveTurnstile(apiKey: string, websiteURL: string, websiteKey: string): Promise<string | null> {
  const create = await fetch(`${CAPSOLVER_API}/createTask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, task: { type: "AntiTurnstileTaskProxyLess", websiteURL, websiteKey } }),
  })
    .then((r) => r.json())
    .catch((err) => ({ errorId: 1, errorDescription: String(err) }));

  if (create.errorId || !create.taskId) {
    console.log(`    capsolver createTask failed: ${create.errorDescription ?? JSON.stringify(create)}`);
    return null;
  }

  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const result = await fetch(`${CAPSOLVER_API}/getTaskResult`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId: create.taskId }),
    })
      .then((r) => r.json())
      .catch((err) => ({ errorId: 1, errorDescription: String(err) }));

    if (result.status === "ready") return result.solution?.token ?? null;
    if (result.errorId || result.status === "failed") {
      console.log(`    capsolver solve failed: ${result.errorDescription ?? JSON.stringify(result)}`);
      return null;
    }
  }
  console.log("    capsolver timed out waiting for a solve");
  return null;
}

export async function createCapsolverFetcher(apiKey: string): Promise<CapsolverFetcher> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed. Run:  npm i -D playwright  then  npx playwright install chromium");
  }
  // Same PROXY_URL httpClient.ts uses for plain requests. CapSolver's own solve
  // step is "proxyless" (it solves the challenge server-side, not through this
  // proxy) — this only affects which IP the page itself is loaded from.
  const browser = await chromium.launch({ headless: true, proxy: playwrightProxy() });

  async function fetchPage(url: string): Promise<FetchResult> {
    await sleep(1000);
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US", viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(3000);

      const sitekey = await page
        .evaluate(() => document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey") ?? null)
        .catch(() => null);

      let solvedWithCapsolver = false;
      if (sitekey) {
        console.log(`    found a Turnstile widget (sitekey ${sitekey}) — asking CapSolver to solve it...`);
        const token = await solveTurnstile(apiKey, url, sitekey);
        if (token) {
          solvedWithCapsolver = true;
          await page.evaluate((t) => {
            const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null;
            if (input) input.value = t;
            const widget = document.querySelector("[data-sitekey]");
            const cb = widget?.getAttribute("data-callback");
            if (cb && typeof (window as any)[cb] === "function") (window as any)[cb](t);
          }, token);
          await page.waitForTimeout(3000);
          await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
        }
      }

      await page.waitForTimeout(1000);
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
        page.url().includes("sgcaptcha") ||
        CHALLENGE_MARKERS.test(title) ||
        (text.length < 1500 && CHALLENGE_MARKERS.test(html.slice(0, 20_000)));
      if (challenged || (!html && text.length === 0)) {
        return {
          ok: false,
          errorReason: "blocked",
          failureDetail: sitekey ? (solvedWithCapsolver ? "capsolver_solved_but_still_challenged" : "capsolver_solve_failed") : "browser_challenge",
          status,
        };
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
      return { ok: false, errorReason: /timeout/i.test(message) ? "timeout" : "error", failureDetail: `capsolver: ${message.split("\n")[0]!.slice(0, 80)}` };
    } finally {
      await context.close();
    }
  }

  return { fetch: fetchPage, close: () => browser.close() };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Fetcher, FetchResult } from "../httpClient.js";

const execFileAsync = promisify(execFile);
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const META = "\n__CURL_META__";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Some Cloudflare sites (apsense.com) challenge the project's standard
// browser-style request (it sends Chrome client-hint headers that do not match
// curl's own TLS fingerprint) but let a plain curl with only a User-Agent
// straight through. This is that plain request, with its own spacing and one
// slow retry when the site pushes back, since it bypasses the shared per-host
// limiter in httpClient.ts.
export function makePlainCurlFetcher(opts: { gapMs: number; pauseOnBlockMs?: number }): Fetcher {
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function once(url: string, signal?: AbortSignal): Promise<FetchResult> {
    try {
      const { stdout } = await execFileAsync(
        CURL_BIN,
        ["-sS", "-L", "--max-redirs", "5", "--compressed", "--max-time", "25", "-A", UA, "-w", `${META}%{http_code}`, url],
        { maxBuffer: 25 * 1024 * 1024, encoding: "utf8", windowsHide: true, signal }
      );
      const at = stdout.lastIndexOf(META);
      if (at < 0) return { ok: false, errorReason: "error", failureDetail: "curl_no_status" };
      const body = stdout.slice(0, at);
      const status = Number(stdout.slice(at + META.length).trim());
      if (status >= 200 && status < 300 && !/<title>Just a moment/i.test(body)) return { ok: true, status, body, url };
      const blocked = status === 403 || status === 429 || status === 503 || /<title>Just a moment/i.test(body);
      return { ok: false, status, errorReason: blocked ? "blocked" : "error", failureDetail: status === 404 || status === 410 ? `http_${status}` : blocked ? "cloudflare_js_challenge" : `http_${status}` };
    } catch {
      return { ok: false, errorReason: "error", failureDetail: "curl_failed" };
    }
  }

  return (url, signal) => {
    const run = async () => {
      const wait = last + opts.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      let res = await once(url, signal);
      last = Date.now();
      if (!res.ok && res.errorReason === "blocked" && opts.pauseOnBlockMs && !signal?.aborted) {
        await sleep(opts.pauseOnBlockMs);
        res = await once(url, signal);
        last = Date.now();
      }
      return res;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };
}

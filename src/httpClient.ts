import "dotenv/config"; // PROXY_URL / MIN_HOST_INTERVAL_MS are read at import time
import { execFile } from "node:child_process";
import dns from "node:dns";
import { promisify } from "node:util";
import CacheableLookup from "cacheable-lookup";
import got, { type Got } from "got";
import { HttpProxyAgent, HttpsProxyAgent } from "hpagent";
import { sleep } from "./util.js";

const execFileAsync = promisify(execFile);

// Requests look like an ordinary desktop Chrome page load. Firewalls decide who to
// challenge partly from the request's identity and headers, and a client that announces
// itself as a crawler (or sends none of the headers a browser always sends) is challenged
// far more often. The set below is what Chrome sends when you open a page in a new tab,
// and it says nothing about who is behind it.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "upgrade-insecure-requests": "1",
  "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};

// --- Optional upstream proxy -------------------------------------------------
// Off unless PROXY_URL is set. Routes through a rotating proxy pool (e.g.
// DataImpulse, or any standard HTTP/HTTPS proxy: http://user:pass@host:port)
// to spread request VOLUME across many outbound IPs — for the ordinary case
// of hitting thousands of unrelated domains from one IP looking like abuse to
// the domains' own hosts/blocklists, not for defeating any one site's
// interactive human check (an IP alone doesn't get past that; see
// browserFetcher/capsolverFetcher for that problem instead).
//
// Costs real money per byte transferred, so it's PAID escalation only — same
// tiered idea as CapSolver below: every request is tried for free first
// (direct, then curl), and the proxy is only spent on a host once every free
// option has already failed and it's still blocked. Most domains never need
// it at all.
const PROXY_URL = process.env.PROXY_URL;
const proxyAgent = PROXY_URL
  ? { http: new HttpProxyAgent({ proxy: PROXY_URL }), https: new HttpsProxyAgent({ proxy: PROXY_URL }) }
  : undefined;

export const httpClient = got.extend({
  timeout: { request: 15000 },
  retry: { limit: 1 },
  headers: { "user-agent": USER_AGENT, ...BROWSER_HEADERS },
  throwHttpErrors: false,
});

// Same client, routed through the proxy — only ever used as a last resort,
// see fetchTextUnthrottled below. Undefined (never reached) when PROXY_URL
// isn't set, same as before.
const httpClientProxied = proxyAgent ? httpClient.extend({ agent: proxyAgent }) : null;

// --- Broken-certificate retry ---------------------------------------------------
// A surprising number of small business sites run an expired, self-signed or
// mismatched TLS certificate. A browser shows a warning you can click through; our
// strict client just fails, and the site was reported as unreachable although its
// contact page was sitting there. We only READ a public page (nothing is sent to
// it), so on a certificate error — and only on that — retry once without
// certificate checking.
const CERT_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
export function isCertError(detail: string | undefined): boolean {
  return Boolean(detail && CERT_ERROR_CODES.has(detail));
}
const httpClientInsecure = httpClient.extend({ https: { rejectUnauthorized: false } });

// --- Public-DNS retry ------------------------------------------------------
// The local/ISP resolver sometimes says "domain doesn't exist" for domains
// that are perfectly alive (seen live on interpages.org). Trusting that
// produces a false "dead domain" verdict, so on a DNS failure we ask public
// resolvers before believing it.
const publicResolver = new dns.promises.Resolver();
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);
const httpClientPublicDns = httpClient.extend({
  dnsCache: new CacheableLookup({ resolver: publicResolver, lookup: false } as any),
});

async function resolvesViaPublicDns(hostname: string): Promise<boolean> {
  for (const resolve of [publicResolver.resolve4.bind(publicResolver), publicResolver.resolve6.bind(publicResolver)]) {
    try {
      if ((await resolve(hostname)).length) return true;
    } catch {
      // NXDOMAIN / no records on this family — try the next
    }
  }
  return false;
}

// How a page is fetched. The default everywhere is the plain HTTP client
// (fetchText); a local script can pass a real-browser fetcher instead for
// sites that challenge plain requests (see contact/browserFetcher.ts).
// `signal`, when passed, lets a caller (see util.ts's withTimeout) actually
// stop an in-flight request instead of just abandoning it to run to its own
// natural end — confirmed live, 2026-10-18: without real cancellation, a
// timed-out domain's remaining candidate fetches kept running orphaned in
// the background, which is what was actually crashing the worker.
export type Fetcher = (url: string, signal?: AbortSignal) => Promise<FetchResult>;

export interface FetchResult {
  ok: boolean;
  status?: number;
  body?: string;
  url?: string; // final URL after redirects — where the request actually landed
  errorReason?: "dns_error" | "timeout" | "blocked" | "error";
  // WHY it failed, for every failure type: the anti-bot vendor/pattern we
  // recognised, the exact HTTP status, or the exact network/TLS error code.
  failureDetail?: string;
  // For DNS failures: the host that actually failed to resolve. After a
  // redirect that is NOT the host we asked for (interpages.org resolves but
  // redirects to semibola.id, which doesn't exist).
  failedHost?: string;
  // Set when the request only succeeded because a fallback kicked in, so
  // reports can say so instead of silently hiding which sites need it.
  usedFallback?: "curl" | "public-dns" | "insecure-tls" | "proxy";
  // From a Retry-After header on 429/503: how long the site asked us to wait.
  retryAfterMs?: number;
}

// "Retry-After" is either a number of seconds or an HTTP date.
function parseRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

// --- Response classification -------------------------------------------------
// Anti-bot layers often answer with HTTP 200 (or a generic 403) and a small
// interstitial page, so status codes alone can't tell a block from a real
// page. First match wins; order matters.
interface Classified {
  errorReason: "blocked" | "error";
  failureDetail: string;
}

const BLOCK_STATUS_LABEL: Record<number, string> = {
  401: "http_401_unauthorized",
  403: "http_403_forbidden",
  406: "http_406_not_acceptable",
  429: "http_429_rate_limited",
  451: "http_451_unavailable_legal",
  503: "http_503_unavailable",
};

function classifyResponse(status: number, body: string, headers: Record<string, unknown>): Classified | null {
  const small = body.length < 60_000; // block/maintenance pages are tiny; real pages aren't

  if (headers["cf-mitigated"] === "challenge") {
    return { errorReason: "blocked", failureDetail: "cloudflare_js_challenge" };
  }
  // SiteGround's captcha answers HTTP 202 with a 169-byte page that only
  // meta-refreshes to /.well-known/sgcaptcha/ — a "successful" status and no
  // keyword any other pattern here matches, so it used to be reported as a
  // real page with no contact info on it.
  if (headers["sg-captcha"] === "challenge" || /\/\.well-known\/sgcaptcha\//i.test(body)) {
    return { errorReason: "blocked", failureDetail: "siteground_captcha" };
  }
  if (small) {
    if (/_cf_chl_opt|cf-browser-verification|<title>\s*just a moment|attention required! \| cloudflare/i.test(body)) {
      return { errorReason: "blocked", failureDetail: "cloudflare_js_challenge" };
    }
    if (/sorry, you have been blocked|cloudflare ray id.*error 10\d\d|error 1020/i.test(body)) {
      return { errorReason: "blocked", failureDetail: "cloudflare_waf_block" };
    }
    if (/ddos-guard/i.test(body)) return { errorReason: "blocked", failureDetail: "ddos_guard" };
    if (/sucuri website firewall|access denied - sucuri/i.test(body)) {
      return { errorReason: "blocked", failureDetail: "sucuri_waf" };
    }
    if (/verify(ing)? (that )?you are (a )?human|are you a robot|px-captcha|captcha-delivery|datadome|press & hold/i.test(body)) {
      return { errorReason: "blocked", failureDetail: "captcha_or_bot_check" };
    }
    if (/one moment,? please|just a moment/i.test(body)) {
      return { errorReason: "blocked", failureDetail: "js_reload_challenge" };
    }
    if (/enable javascript and cookies to continue/i.test(body)) {
      return { errorReason: "blocked", failureDetail: "js_required" };
    }
    if (/briefly unavailable for scheduled maintenance|undergoing (scheduled )?maintenance|be right back|coming soon/i.test(body) && body.length < 20_000) {
      return { errorReason: "error", failureDetail: "site_maintenance_mode" };
    }
    // A "successful" response that is just a stub which redirects the browser
    // elsewhere is not the site's real page (got follows HTTP redirects, not
    // meta refreshes). Not necessarily a block, so it's an error, not blocked.
    if (status < 400 && body.length < 800 && /<meta[^>]+http-equiv=["']?refresh/i.test(body)) {
      return { errorReason: "error", failureDetail: "meta_refresh_stub_page" };
    }
  }
  if (status in BLOCK_STATUS_LABEL) {
    return { errorReason: "blocked", failureDetail: BLOCK_STATUS_LABEL[status] };
  }
  if (status >= 400) return { errorReason: "error", failureDetail: `http_${status}` };
  return null;
}

async function gotFetch(client: Got, url: string, signal?: AbortSignal): Promise<FetchResult> {
  try {
    const res = await client.get(url, { signal });
    const bad = classifyResponse(res.statusCode, res.body, res.headers as Record<string, unknown>);
    if (bad) {
      return {
        ok: false,
        status: res.statusCode,
        ...bad,
        retryAfterMs: parseRetryAfterMs(res.headers["retry-after"]),
      };
    }
    return { ok: true, status: res.statusCode, body: res.body, url: res.url };
  } catch (err: any) {
    if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
      return {
        ok: false,
        errorReason: "dns_error",
        failureDetail: `${err.code}_on_local_resolver`,
        // got wraps the DNS error, so the failing hostname (which after a
        // redirect differs from the URL we requested) only survives in the
        // message: "getaddrinfo ENOTFOUND semibola.id".
        failedHost: /(?:ENOTFOUND|EAI_AGAIN)\s+([A-Za-z0-9.-]+)/.exec(String(err.message))?.[1] ?? err.hostname ?? hostOf(url),
      };
    }
    if (err.name === "TimeoutError") {
      return { ok: false, errorReason: "timeout", failureDetail: "no_response_within_15s" };
    }
    return { ok: false, errorReason: "error", failureDetail: err.code ?? err.name ?? "unknown_network_error" };
  }
}

// --- curl fallback -----------------------------------------------------------
// Cloudflare decides partly on the client's TLS fingerprint. Our Node client
// gets challenged on some sites where the system `curl` (a different TLS
// stack) is let straight through with the identical User-Agent — measured on
// sooperarticles.com. So when Node is challenged/forbidden we retry ONCE
// through system curl. No paid service, no browser, and deliberately never
// routed through the proxy either — this is the free fix, tried before the
// paid one.
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";
const CURL_ELIGIBLE = new Set([
  "cloudflare_js_challenge",
  "cloudflare_waf_block",
  "http_403_forbidden",
  "http_406_not_acceptable",
]);
const META_MARKER = "\n__CURL_META__";

async function curlFetch(url: string, signal?: AbortSignal): Promise<FetchResult | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

    const { stdout } = await execFileAsync(
      CURL_BIN,
      [
        "-sS", "-L", "--max-redirs", "5", "--compressed", "--max-time", "20",
        "-A", USER_AGENT,
        ...Object.entries(BROWSER_HEADERS).flatMap(([name, value]) => ["-H", `${name}: ${value}`]),
        "-w", `${META_MARKER}%{http_code} %{url_effective}`,
        parsed.href,
      ],
      {
        maxBuffer: 25 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
        env: process.env,
        signal, // sends SIGTERM to the curl child process on abort, same effect as cancelling a got request
      }
    );

    const at = stdout.lastIndexOf(META_MARKER);
    if (at < 0) return null;
    const body = stdout.slice(0, at);
    const [code, ...rest] = stdout.slice(at + META_MARKER.length).trim().split(" ");
    const status = Number(code);

    const bad = classifyResponse(status, body, {});
    if (bad) return { ok: false, status, ...bad };
    return { ok: true, status, body, url: rest.join(" ") || url };
  } catch {
    return null;
  }
}

// Hosts that already needed a fallback this process: skip straight to it so
// we don't burn a doomed request per page on a site we know rejects Node.
const hostsNeedingCurl = new Set<string>();
const hostsNeedingPublicDns = new Set<string>();
const hostsNeedingInsecureTls = new Set<string>();
// A host only lands here after EVERY free option already failed on it once —
// see the end of fetchTextUnthrottled. Skipping straight to the proxy on
// repeat requests to the same host saves time, not money (the proxy is paid
// either way once reached), but there's no reason to re-prove the free
// options don't work for a host that's already shown they don't.
const hostsNeedingProxy = new Set<string>();

export function fallbackDescription(fallback: FetchResult["usedFallback"]): string | null {
  if (fallback === "curl") return "reachable only via curl fallback (Cloudflare challenges our Node HTTP client)";
  if (fallback === "public-dns") return "reachable only via public-DNS fallback (local resolver failed)";
  if (fallback === "insecure-tls") return "site has an invalid or expired security certificate (page read anyway)";
  if (fallback === "proxy") return "reachable only through the paid proxy (blocked on every free attempt)";
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// --- Per-host rate limiting --------------------------------------------------
// The spec's non-negotiable: no more than one request per domain every 2-3s,
// enforced globally for EVERY request to a host — discovery, article fetches,
// contact lookups, curl fallback, all of it — not just within one caller's own
// loop. Two different code paths hitting the same host at the same moment
// (e.g. two prospects that happen to redirect to one domain) would otherwise
// have no idea about each other. A per-host queue serializes them here, in
// the one place all outbound requests actually go through.
const MIN_HOST_INTERVAL_MS = Number(process.env.MIN_HOST_INTERVAL_MS) || 2500;
const MAX_HOST_INTERVAL_MS = 20_000;
const hostIntervalMs = new Map<string, number>(); // raised for a host after it rate-limits us
const lastRequestDoneAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<void>>();

// A host that has backed off even once is no longer "2.5s per request" — a
// caller working through many sequential candidates on the same host (the
// pipeline's per-domain loop) can use this to stop early once the site has
// made clear it's rate-limiting us hard, rather than grinding through the
// rest of its budget at an ever-growing per-request cost. Threshold is "gap
// has at least doubled twice" (10s, a quarter of the 20s ceiling) — one
// 429 can be a fluke, a host that's kept re-triggering backoff hasn't been.
const HEAVY_RATE_LIMIT_THRESHOLD_MS = MIN_HOST_INTERVAL_MS * 4;
export function isHostHeavilyRateLimited(host: string): boolean {
  return (hostIntervalMs.get(host) ?? MIN_HOST_INTERVAL_MS) >= HEAVY_RATE_LIMIT_THRESHOLD_MS;
}

// Runs `work` only after every earlier request to this host has finished AND
// the host's minimum gap has passed since the last one ended. The gap is
// measured from when the previous request FINISHED, so a slow response
// doesn't get the next request fired straight on its heels.
async function throttled<T>(host: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const prior = hostQueue.get(host) ?? Promise.resolve();
  const run = prior.then(async () => {
    const gap = hostIntervalMs.get(host) ?? MIN_HOST_INTERVAL_MS;
    const wait = gap - (Date.now() - (lastRequestDoneAt.get(host) ?? 0));
    // Don't make an already-abandoned caller sit out the rest of its queue
    // wait for nothing — same spirit as the real fetch cancellation below.
    if (wait > 0 && !signal?.aborted) await sleep(wait);
    try {
      return await work();
    } finally {
      lastRequestDoneAt.set(host, Date.now());
    }
  });
  hostQueue.set(host, run.then(() => {}, () => {})); // a failing request must not wedge the queue
  return run;
}

// On a 429 the site told us directly to slow down. Wait out its Retry-After
// (default 8s, capped at 30s) and try once more — and double this host's
// minimum gap for the rest of the run, so we don't trip the same limit again.
async function backOffAndRetry(host: string, first: FetchResult, refetch: () => Promise<FetchResult>): Promise<FetchResult> {
  hostIntervalMs.set(host, Math.min((hostIntervalMs.get(host) ?? MIN_HOST_INTERVAL_MS) * 2, MAX_HOST_INTERVAL_MS));
  await sleep(Math.min(first.retryAfterMs ?? 8000, 30_000));
  return refetch();
}

// Circuit breaker. Once a host has refused us three times in a row, further
// requests to it just add load to a site that has already said no — and were
// the exact way mysolutionwellbeing.com went from working to captcha-walling
// us during testing. So stop asking for a while; report why instead.
//
// Blocked and timed-out hosts are tracked SEPARATELY, on purpose, even
// though both end in the same "stop asking for a while" behavior: a host
// that's actively blocking us is worth the extra escalation (a real browser
// sometimes gets past a block — see runCampaign.ts's withBlockedEscalation),
// but a host that's simply not responding gets nothing out of that — a
// browser can't make a dead/slow server answer faster, so it would just add
// an expensive, pointless extra attempt. Keeping errorReason "timeout"
// (never "blocked") for this case means that expensive escalation path is
// never mistakenly triggered for a host that was never blocking us at all.
//
// This is what actually fixes the slow case: previously a host that timed
// out on every request paid the FULL 15s wait on every one of up to 50
// tries (12+ minutes) with no shortcut, because only "blocked" tripped the
// breaker. Now only the first 3 pay that cost; the rest skip instantly.
const BLOCK_STREAK_LIMIT = 3;
const BLOCK_COOLDOWN_MS = 10 * 60_000;
const TIMEOUT_STREAK_LIMIT = 3;
const TIMEOUT_COOLDOWN_MS = 10 * 60_000;

interface HostFailureState {
  blockedStreak: number;
  blockedLastAt: number;
  timeoutStreak: number;
  timeoutLastAt: number;
}
const hostFailureState = new Map<string, HostFailureState>();

function circuitOpen(host: string): "blocked" | "timeout" | null {
  const s = hostFailureState.get(host);
  if (!s) return null;
  if (s.blockedStreak >= BLOCK_STREAK_LIMIT && Date.now() - s.blockedLastAt < BLOCK_COOLDOWN_MS) return "blocked";
  if (s.timeoutStreak >= TIMEOUT_STREAK_LIMIT && Date.now() - s.timeoutLastAt < TIMEOUT_COOLDOWN_MS) return "timeout";
  return null;
}

function recordOutcome(host: string, result: FetchResult) {
  if (result.ok) {
    hostFailureState.delete(host);
    return;
  }
  if (result.errorReason !== "blocked" && result.errorReason !== "timeout") return;

  const s = hostFailureState.get(host) ?? { blockedStreak: 0, blockedLastAt: 0, timeoutStreak: 0, timeoutLastAt: 0 };
  if (result.errorReason === "blocked") {
    s.blockedStreak++;
    s.blockedLastAt = Date.now();
  } else {
    s.timeoutStreak++;
    s.timeoutLastAt = Date.now();
  }
  hostFailureState.set(host, s);
}

export async function fetchText(url: string, signal?: AbortSignal): Promise<FetchResult> {
  const host = hostOf(url);

  const openReason = circuitOpen(host);
  if (openReason === "blocked") {
    return {
      ok: false,
      errorReason: "blocked",
      failureDetail: `skipped_after_${BLOCK_STREAK_LIMIT}_consecutive_blocks (cooling down ${BLOCK_COOLDOWN_MS / 60_000} min)`,
    };
  }
  if (openReason === "timeout") {
    return {
      ok: false,
      errorReason: "timeout",
      failureDetail: `skipped_after_${TIMEOUT_STREAK_LIMIT}_consecutive_timeouts (site not responding, cooling down ${TIMEOUT_COOLDOWN_MS / 60_000} min)`,
    };
  }

  const result = await throttled(host, () => fetchTextUnthrottled(url, host, signal), signal);
  recordOutcome(host, result);
  return result;
}

async function fetchTextUnthrottled(url: string, host: string, signal?: AbortSignal): Promise<FetchResult> {
  if (hostsNeedingProxy.has(host) && httpClientProxied) {
    const viaProxy = await gotFetch(httpClientProxied, url, signal);
    if (viaProxy.ok) return { ...viaProxy, usedFallback: "proxy" };
  }

  if (hostsNeedingCurl.has(host)) {
    const viaCurl = await curlFetch(url, signal);
    if (viaCurl?.ok) return { ...viaCurl, usedFallback: "curl" };
  }

  const client = () =>
    hostsNeedingInsecureTls.has(host) ? httpClientInsecure : hostsNeedingPublicDns.has(host) ? httpClientPublicDns : httpClient;
  let result = await gotFetch(client(), url, signal);

  if (!result.ok && isCertError(result.failureDetail)) {
    const retry = await gotFetch(httpClientInsecure, url, signal);
    if (retry.ok) {
      hostsNeedingInsecureTls.add(host);
      return { ...retry, usedFallback: "insecure-tls" };
    }
    result = retry;
  }

  if (!result.ok && result.failureDetail === "http_429_rate_limited") {
    result = await backOffAndRetry(host, result, () => gotFetch(client(), url, signal));
  }

  if (!result.ok && result.errorReason === "dns_error") {
    // The local resolver failed. Before believing "domain doesn't exist",
    // ask public resolvers — and ask about the host that actually failed,
    // which after a redirect may not be the one we requested.
    const failed = result.failedHost ?? host;
    if (!(await resolvesViaPublicDns(failed))) {
      const proof = "NXDOMAIN on local resolver, 1.1.1.1 and 8.8.8.8";
      return {
        ...result,
        failureDetail:
          failed === host
            ? `domain_does_not_exist (${proof})`
            : `redirects_to_${failed}_which_does_not_exist (${proof})`,
      };
    }
    const retry = await gotFetch(httpClientPublicDns, url, signal);
    if (retry.ok) hostsNeedingPublicDns.add(host);
    result = retry.ok ? { ...retry, usedFallback: "public-dns" } : retry;
  }

  // A dropped TLS connection is how many WAFs reject a client fingerprint
  // they don't like, so resets get the same curl second chance as 403s.
  const connectionDropped = result.errorReason === "error" && /^(ECONNRESET|EPIPE|ECONNABORTED|UND_ERR_SOCKET)/.test(result.failureDetail ?? "");
  if (
    !result.ok &&
    ((result.errorReason === "blocked" && result.failureDetail && CURL_ELIGIBLE.has(result.failureDetail)) || connectionDropped)
  ) {
    const viaCurl = await curlFetch(url, signal);
    if (viaCurl?.ok) {
      hostsNeedingCurl.add(host);
      return { ...viaCurl, usedFallback: "curl" };
    }
  }

  // Last resort, and the only PAID step in this whole chain: every free
  // option above has already failed and the host is still blocked. Only
  // reached once per host (hostsNeedingProxy short-circuits straight here on
  // repeat requests), and never reached at all for a host the free options
  // already handle.
  if (!result.ok && result.errorReason === "blocked" && httpClientProxied) {
    const viaProxy = await gotFetch(httpClientProxied, url, signal);
    if (viaProxy.ok) {
      hostsNeedingProxy.add(host);
      return { ...viaProxy, usedFallback: "proxy" };
    }
  }

  return result;
}

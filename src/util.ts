export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {}

// Hard safety net around a single domain/prospect's worth of work. Every
// individual network call already has its own timeout (httpClient.ts,
// browserFetcher, capsolverFetcher), but those only guard ONE request —
// nothing previously bounded the TOTAL time one domain could consume if
// something hung in a way no inner timeout caught (confirmed live: two
// campaigns stalled for 20+ minutes with zero DB activity, no stuck lock, no
// stuck transaction — meaning something downstream of all the usual timeouts
// was genuinely stuck). This should have existed from the start for a
// crawler hitting arbitrary external domains, not added after the fact.
//
// The losing side of the race is NOT cancelled (JS can't actually cancel a
// pending network call) — it keeps running in the background and its result
// is just discarded, which is fine: it costs that one lingering request, not
// a permanently blocked worker slot.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError(`${label}: no result within ${ms / 1000}s`)), ms)),
  ]);
}

// Playwright wants proxy auth split out of the URL (a `server` with embedded
// user:pass in the string is rejected), unlike hpagent in httpClient.ts which
// takes the whole PROXY_URL as one string.
//
// Deliberately its own env var by default (RESCUE_PROXY_URL, not PROXY_URL):
// httpClient.ts applies PROXY_URL to every plain request, but the whole point
// of a proxy here is to spend it only on domains that already came back
// blocked. Local one-off rescue scripts (rescue-domains.ts etc.) are already
// scoped to a small blocked-only list, so they pass "PROXY_URL" explicitly to
// reuse whatever the local .env already has.
export function playwrightProxy(envVar = "RESCUE_PROXY_URL"): { server: string; username?: string; password?: string } | undefined {
  const raw = process.env[envVar];
  if (!raw) return undefined;
  const url = new URL(raw);
  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

export function toCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

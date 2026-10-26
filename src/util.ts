export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Discovery/extraction hand postDate strings around as loose, unvalidated
// text pulled from feeds, JSON-LD, URL slugs, etc. — most parse fine, but a
// genuinely malformed one (confirmed live, 2026-10-24, during the Priya
// no-posts-found recovery) reaches the DB insert as `new Date(garbage)`,
// an Invalid Date, and Postgres's driver throws RangeError on
// .toISOString() at insert time, crashing the whole batch instead of just
// that one row. Centralizes the same "don't trust it, don't guess, keep
// going" rule this codebase already applies to missing dates elsewhere.
export function toValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
// `controller`, when passed, gets aborted the moment this timeout fires —
// confirmed live, 2026-10-18: without this, "the losing side just keeps
// running in the background" was NOT a one-off lingering request as
// originally assumed here. A domain with a genuinely huge candidate list
// (thousands of posts) can be mid-loop through hundreds of remaining
// candidates when the outer timeout gives up on it; every one of those
// still runs to completion, unbounded, in a process nothing is watching
// anymore. Pile up two or three abandoned domains like that at once and the
// combined orphaned work exhausts the heap and crashes the whole worker —
// reproduced locally, twice, chasing exactly this. Passing a controller
// lets the caller's fetcher actually stop mid-request instead of running to
// its own natural end regardless of who's still listening.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string, controller?: AbortController): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        controller?.abort();
        reject(new TimeoutError(`${label}: no result within ${ms / 1000}s`));
      }, ms)
    ),
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

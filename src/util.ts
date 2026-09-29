export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

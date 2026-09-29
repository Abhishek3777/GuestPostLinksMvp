export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Playwright wants proxy auth split out of the URL (a `server` with embedded
// user:pass in the string is rejected), unlike hpagent in httpClient.ts which
// takes the whole PROXY_URL as one string. Same env var, two shapes.
export function playwrightProxy(): { server: string; username?: string; password?: string } | undefined {
  const raw = process.env.PROXY_URL;
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

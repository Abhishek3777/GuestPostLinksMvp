// request.url (and `new URL(request.url).origin`) reflects the container's
// internal bind address once deployed behind Railway's proxy — e.g.
// "https://0.0.0.0:8080" — not the public domain. Any redirect built from it
// lands on an address the browser can't reach. This reconstructs the real,
// public origin from the headers the proxy actually forwards.
export function getOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")!;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

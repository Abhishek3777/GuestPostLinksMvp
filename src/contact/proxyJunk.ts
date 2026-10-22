// Requests a PAID-PROXY browser should never make.
//
// The residential proxy bills per GB, and the rescue browsers only ever read
// page.content()/innerText. DataImpulse's own per-host report (15 Sep-22 Oct
// 2026, 118 GB) put roughly 40% of all bytes on third-party hosts that carry no
// contact information: tag managers, ad networks, video players, captcha
// widgets, analytics. images/fonts/media were already aborted by resource type;
// scripts and iframes from these hosts were not.
//
// DELIBERATELY NOT HERE: challenges.cloudflare.com and anything else a bot wall
// needs to clear itself. That host was the single biggest line (13 GB) but it is
// the challenge the rescue exists to pass — blocking it would turn every
// recoverable Cloudflare site into a permanent block. Every new entry should
// answer "can a bot wall or the contact details depend on this?" with no.
//
// Switch off with PROXY_BLOCK_JUNK=false.

const JUNK_HOST_SUFFIXES = [
  // tags / analytics / session replay
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "hotjar.com",
  "clarity.ms",
  "newrelic.com",
  "nr-data.net",
  "scorecardresearch.com",
  "quantserve.com",
  // ads
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "adsrvr.org",
  // social widgets / pixels
  "connect.facebook.net",
  "platform.twitter.com",
  "platform.linkedin.com",
  "snap.licdn.com",
  "tiktok.com",
  "pinterest.com",
  // video / media embeds
  "youtube.com",
  "youtube-nocookie.com",
  "ytimg.com",
  "vimeo.com",
  "vimeocdn.com",
  "wistia.com",
  "wistia.net",
  "jwplatform.com",
  "jwpcdn.com",
  "brightcovecdn.com",
  "brightcove.net",
  // scheduling widgets / maps
  "calendly.com",
  "maps.googleapis.com",
  "maps.gstatic.com",
  // captcha widgets: the rescue reads text, it never submits a form
  // (CapSolver's Turnstile step reads the sitekey from the DOM, not the widget)
  "hcaptcha.com",
  "www.gstatic.com",
];

// google.com is also a legitimate page host, so only its widget paths go.
const JUNK_PATH_PREFIXES: Array<{ host: string; path: string }> = [
  { host: "www.google.com", path: "/recaptcha/" },
  { host: "www.google.com", path: "/maps" },
  { host: "www.google.com", path: "/pagead/" },
  { host: "www.facebook.com", path: "/tr" },
  { host: "www.facebook.com", path: "/plugins/" },
];

// Fire-and-forget resource types: they return nothing a page reader needs.
const JUNK_RESOURCE_TYPES = new Set(["ping", "websocket", "eventsource"]);

export function proxyJunkEnabled(): boolean {
  return process.env.PROXY_BLOCK_JUNK !== "false";
}

export function isProxyJunk(rawUrl: string, resourceType: string): boolean {
  if (JUNK_RESOURCE_TYPES.has(resourceType)) return true;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  for (const suffix of JUNK_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith("." + suffix)) return true;
  }
  return JUNK_PATH_PREFIXES.some((r) => host === r.host && u.pathname.startsWith(r.path));
}

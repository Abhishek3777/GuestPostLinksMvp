// Hijacked-gambling-domain detection. Decided alongside the discussion in
// exclusions.ts:134-138: this needs the target page's actual content, which
// Stage 2 doesn't have — only usable once Stage 3 has fetched the page.
//
// The NAME-signal half is ported verbatim from the legacy pipeline's
// exclusions.py (GAMBLING_NAME_TOKENS / name_suggests_gambling /
// is_hijacked_gambling) — same token list, same substring match (Python's
// `tok in label` is substring, not exact-label, and that's deliberate here:
// short tokens like "win"/"bet" need to catch compounds like "1win-casino-pl").
//
// The CONTENT-signal half has no legacy source to port — the Python system
// got this from a separate scraper tool ("GP-Email-Scraper") that computed
// it externally and was never part of this handover (confirmed missing from
// disk). This keyword list is new, built fresh for this port, not a copy of
// anything that previously existed.
import { parse } from "tldts";
import { visibleTextOf } from "./visibleText.js";

const GAMBLING_NAME_TOKENS = [
  "bet", "casino", "slot", "poker", "gambl", "wager", "jackpot", "roulette",
  "baccarat", "blackjack", "lotto", "lottery", "bingo", "punt", "bookie",
  "vegas", "spin", "win", "luck", "rummy", "teenpatti", "satta", "aviator",
  "gaming", "kasino", "judi", "toto", "sportsbook", "odds", "parlay",
] as const;

function labelOf(rootDomain: string): string {
  const parsed = parse(rootDomain.trim().toLowerCase(), { allowPrivateDomains: false });
  return parsed.domainWithoutSuffix ?? rootDomain;
}

// True if the domain NAME itself signals gambling (so content matching it is
// consistent, not a takeover). Substring match on purpose — see header.
export function nameSuggestsGambling(rootDomain: string): boolean {
  const label = labelOf(rootDomain);
  return GAMBLING_NAME_TOKENS.some((tok) => label.includes(tok));
}

// Content-side signals. Deliberately broader/more specific than the name
// token list (real page text, not just a domain label) — betting-specific
// vocabulary a legitimate non-gambling business essentially never uses.
//
// Tightened after a real false-positive run (2026-10-12) against marketing's
// own "good" examples: checking the RAW page HTML (not just visible text)
// matched "rtp" inside base64 blobs and a minified `theme.rtl` JS variable,
// "promo code" on an ordinary e-commerce checkout flow, and bare "slots" on
// a Wix component's literal `slots="[object object]"` attribute — none of
// them anything to do with gambling. Fix has two parts: (1) match against
// visibleTextOf() instead of raw HTML, so script/attribute noise is gone
// before matching even starts, and (2) drop "rtp" (too short, inherently
// collision-prone), "promo code" and "download the app" (both common,
// ordinary e-commerce/app language with no gambling specificity) outright —
// kept "slot machine" (safe, specific) and "download apk"/"android apk"
// (legitimate businesses essentially never say "APK," that's specifically
// an Android-sideloading term gambling apps use to dodge Play Store review).
const GAMBLING_CONTENT_TOKENS = [
  "casino", "sportsbook", "wagering", "wager", "welcome bonus", "free spins",
  "deposit bonus", "betting", "parlay", "jackpot", "roulette",
  "blackjack", "baccarat", "slot machine", "poker room",
  "gamble responsibly", "gambling problem", "18+ only",
  "download apk", "android apk",
] as const;

export function contentLooksLikeGambling(pageText: string): boolean {
  const text = visibleTextOf(pageText);
  return GAMBLING_CONTENT_TOKENS.some((tok) => text.includes(tok));
}

// Gambling content on a domain whose name promises something else.
export function isHijackedGambling(rootDomain: string, pageText: string): boolean {
  return contentLooksLikeGambling(pageText) && !nameSuggestsGambling(rootDomain);
}

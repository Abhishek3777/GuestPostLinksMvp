// "Is this an actual business worth contacting" — the one check in this
// whole filter set that genuinely can't be done with keywords (see
// docs/prospect-relevance-filter.md for why). One OpenAI call per domain,
// using the page content Stage 3 already fetched for contact lookup — no
// extra crawl. Deliberately plain fetch(), not the `openai` npm package —
// this project doesn't carry heavy API SDKs for anything else (CapSolver,
// etc. are all raw HTTP too), and the one call this makes doesn't need one.
import { parse } from "tldts";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { domainRelevanceCache } from "../db/schema.js";
import { visibleTextOf } from "./visibleText.js";

// Free pre-filter, zero API cost: a domain literally named "...scholarship..."
// is never going to be a business — catches 2 of marketing's 4 real
// personal/scholarship examples outright, no AI call needed for those.
export function looksLikeScholarshipDomain(rootDomain: string): boolean {
  const label = parse(rootDomain.trim().toLowerCase(), { allowPrivateDomains: false }).domainWithoutSuffix ?? "";
  return label.includes("scholarship");
}

export type RelevanceDecision = "keep" | "exclude" | "unsure";

export interface RelevanceResult {
  decision: RelevanceDecision;
  reason: string;
}

const MODEL = "gpt-4o-mini";

// Marketing's own stated criteria (2026-10-08 written response), not an
// assumption — see docs/prospect-relevance-filter.md. Deliberately does NOT
// mention gambling or government/institutional sites: those are filtered
// separately, before this ever runs, so this prompt's only job is the one
// question keywords can't answer.
const SYSTEM_PROMPT = `You are screening backlink domains for a digital marketing agency's outreach list. For each domain, decide whether it is a real, operating business worth pitching marketing/SEO/backlink services to.

KEEP: B2B companies, SaaS businesses, e-commerce brands, and any other commercial product or service business with a real online presence. This explicitly includes small local trades (plumbers, contractors, remodelers, etc.) and local alcohol/spirits producers — these are good prospects, not junk.

EXCLUDE: personal or individual pages (someone's personal blog, a personal professional profile with no business behind it), scholarship funds, memorial pages, or any page that isn't actually a commercial business at all.

If you cannot tell from what's given, answer UNSURE rather than guessing.

Respond with EXACTLY one line, nothing else: the word KEEP, EXCLUDE, or UNSURE, then a colon, then a short reason (under 15 words).`;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function buildUserPrompt(rootDomain: string, pageHtml: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(pageHtml)?.[1]?.trim() ?? "(no title found)";
  const metaDesc =
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(pageHtml)?.[1]?.trim() ?? "(no meta description)";
  const snippet = truncate(visibleTextOf(pageHtml), 600);
  return `Domain: ${rootDomain}\nPage title: ${title}\nMeta description: ${metaDesc}\nPage text snippet: ${snippet}`;
}

function parseResponse(raw: string): RelevanceResult {
  const match = /^(keep|exclude|unsure)\s*:\s*(.+)$/i.exec(raw.trim());
  if (!match) return { decision: "unsure", reason: `unparseable model response: ${truncate(raw, 100)}` };
  return { decision: match[1].toLowerCase() as RelevanceDecision, reason: match[2].trim() };
}

// Fails safe: any error (missing key, network, timeout, bad response) comes
// back as "keep" — never silently drop a possibly-real lead to an
// infrastructure hiccup, same rule as everything else in this pipeline.
export async function classifyBusinessRelevance(rootDomain: string, pageHtml: string): Promise<RelevanceResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { decision: "keep", reason: "OPENAI_API_KEY not set, skipping classification" };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(rootDomain, pageHtml) },
        ],
        temperature: 0,
        max_tokens: 40,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { decision: "keep", reason: `OpenAI call failed: ${res.status} ${truncate(body, 150)}` };
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { decision: "keep", reason: "OpenAI returned no content" };
    return parseResponse(content);
  } catch (err) {
    return { decision: "keep", reason: `OpenAI call error: ${(err as Error).message}` };
  }
}

// The cached entry point — this is what callers should actually use, not
// classifyBusinessRelevance directly. Checks domain_relevance_cache first
// (no expiry — see the table's own comment in src/db/schema.ts for why
// that's safe); only calls OpenAI and only then writes the cache on a miss.
// onConflictDoNothing covers the race where two domains are checked at once
// and happen to be the same root domain — whichever insert loses just keeps
// the winner's row, no error, no duplicate spend wasted either way.
export async function classifyBusinessRelevanceCached(rootDomain: string, pageHtml: string): Promise<RelevanceResult> {
  const [cached] = await db.select().from(domainRelevanceCache).where(eq(domainRelevanceCache.domain, rootDomain));
  if (cached) return { decision: cached.decision as RelevanceDecision, reason: cached.reason ?? "" };

  const result = await classifyBusinessRelevance(rootDomain, pageHtml);
  await db
    .insert(domainRelevanceCache)
    .values({ domain: rootDomain, decision: result.decision, reason: result.reason })
    .onConflictDoNothing();
  return result;
}

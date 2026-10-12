# Prospect relevance filter — design notes

## The problem

Backlink domains that pass today's Stage 2 exclusion rules still include things
that are not real prospects for outreach — e.g. from a real export (campaign
"30"): `cryptocasino-reviews.com`, `martin-casino-au.info`,
`1win-casino-pl.net`, `antonios-remodeling.com`, `handlekraft.ro`,
`baltimorespiritsco.com`.

None of today's 9 exclusion reasons (`do_not_contact`, `gov_edu_tld`,
`excluded_domain`, `parked_domain`, `url_shortener`, `invalid_domain`,
`big_brand`, `claimed_by_teammate`, `already_found` — see
`src/filter/exclusions.ts` and `src/filter/index.ts`) catch these. This is a
genuine gap, not a regression — confirmed by reading the legacy Python
pipeline (`extracted/GuestPostLinks/`) in full: it never had a check for this
either. See "What the legacy system actually did" below.

## The actual bar, per the user (2026-10-08)

Not "is this a legitimate business" — narrower than that:

> **"we want to contact businesses, like proper, which wud need our help."**

I.e. would this business realistically want/benefit from ACG's marketing
services (SEO / backlinks / guest posts)? A real, well-run local remodeling
contractor is a legitimate business — it's still excluded, because it's not a
realistic buyer of this kind of service.

## What the legacy system actually did (and why it's not a template to copy as-is)

Read in full: `extracted/GuestPostLinks/exclusions.py:191-214`,
`merge_contacts.py:103-112`, design rationale in
`extracted/GuestPostLinks/PROJECT-NOTES.md:42-61` (agreed with the client,
"Daisy," 2026-08-08).

The legacy gambling rule was **not** "exclude gambling" — it was a
hijacked-domain detector:

```python
GAMBLING_NAME_TOKENS = ("bet", "casino", "slot", "poker", "gambl", "wager",
    "jackpot", "roulette", ..., "win", "luck", ...)

def is_hijacked_gambling(root_domain, gambling_flagged):
    return bool(gambling_flagged) and not name_suggests_gambling(root_domain)
```

Only excluded a domain if it had gambling CONTENT but a name with NO gambling
signal (e.g. a hijacked/compromised site). If the name itself said "casino" or
"win," the legacy system treated that as a genuine gambling business and
**kept** it — "genuine gambling businesses like betr.com.au are kept; iGaming
buys links" (PROJECT-NOTES.md:52).

**RESOLVED (2026-10-08):** use the legacy hijacked-only logic as-is — "some
gambling we can contact which got actual business [i.e. genuine gambling
companies], but a lot of domains we need not as they aren't relevant to us
[i.e. hijacked ones]." Confirmed with a live example: `antonios-remodeling.com`
(one of the original 6 bad examples) currently resolves to a 1Win
casino/betting APK download page — name gives no gambling signal, content is
pure gambling → exactly the hijacked case the legacy rule targets, and it
would correctly exclude this one. `cryptocasino-reviews.com` /
`martin-casino-au.info` / `1win-casino-pl.net` (names DO signal gambling) stay
**kept** under this rule — accepted tradeoff, not a bug.

No rule anywhere in the legacy system (or the current one) ever touched
"is this business a fit for our services" — confirmed by reading
`PROJECT-NOTES.md`, `CHEATSHEET.md`, and all of `exclusions.py` for any
industry/relevance check. It was never in scope, old or new.

## Where the plan stands

### 1. Gambling/casino — confirmed, port legacy logic as-is
Two keyword checks, no AI: (a) does the domain NAME contain a gambling token
(casino, bet, slot, poker, gambl, wager, jackpot, roulette, win, luck, ...),
(b) does the fetched page CONTENT contain gambling signals (casino, betting,
deposit, wagering, APK/bonus-download language, etc.). Exclude only when
content is gambling AND the name is not — the hijacked case. A gambling-named
domain with gambling content is a genuine business and stays kept. Needs the
page content Stage 3 already fetches for contact lookup — no extra crawl.

### 2. "Would this business need our help" (the hard part)
This is a judgment call, not a pattern match — a remodeling company's
homepage reads exactly like any other normal business site; there's no
reliable keyword that separates "legitimate business we don't want" from
"legitimate business we do want."

Two paths, not mutually exclusive:

- **Non-AI (partial, maintainable)**: a blocklist of named industries/business
  types the user explicitly doesn't want (local trades, remodeling/contractor,
  alcohol/spirits producers, etc. — **list still needed from the user**),
  matched against homepage title/meta/snippet text. Catches named categories
  only; anything not on the list still gets through, and the list needs
  ongoing upkeep as new junk categories appear.
- **AI-assisted (more complete, small cost)**: an LLM call per domain,
  reusing the page content Stage 3 already fetches for contact lookup (no
  extra crawl). Estimated cost: well under $0.001/domain using a cheap model
  (e.g. gpt-4o-mini) — the current combined backlog across all 3 campaigns
  (~20k+ kept prospects) estimated at roughly $2-4 total, one-time, since
  results would be cached per-domain (classify once, reuse across every
  future campaign — same pattern as `do_not_contact`). **Estimate only, not
  confirmed against live pricing** — plan is to test on a small batch (50-100
  domains) first and measure real cost/accuracy before running it against the
  full backlog.

**Recommended sequencing**: build the gambling keyword check and the
industry blocklist first (both non-AI, cheap, fast to ship). Evaluate real
results against them. Only add the AI classification layer if the blocklist
approach is still letting too much through after real-world testing — not
before.

## Implementation notes (once rules are confirmed)

- New exclusion reason(s) added alongside the existing 9 in
  `src/filter/exclusions.ts` — same mechanism, same precedence-list pattern,
  nothing else about the pipeline changes.
- If AI classification is added: runs inside Stage 3 (`src/contact/`),
  reusing the homepage fetch already happening there. Result cached per
  domain (new table or column, not per-campaign) so each domain is judged
  once, ever. Fails safe — keeps a domain if the classification call errors,
  never silently drops a possibly-real lead.

## Status — implemented and wired in (2026-10-12)

Marketing sent their real written requirements (`MarketingResponseBacklink.docx`,
repo root) instead of the earlier planned blocklist-of-industries approach —
superseded the non-AI-blocklist direction below. Their actual criteria: keep
B2B/SaaS/e-commerce/local-trades/spirits producers; exclude gambling content
(broader than the hijacked-only rule above — confirmed via a live example,
`valter129.casino`, that marketing wants excluded even though its name and
content agree, which the hijacked-only rule would have kept), government and
financial-institution sites, and personal/individual/scholarship pages.

Built:
- `src/filter/gambling.ts` — content-based gambling exclusion (name-match
  nuance kept as metadata only, no longer gates the decision)
- `src/filter/institutional.ts` — government/financial-institution detection
- `src/filter/visibleText.ts` — strips HTML to visible text before keyword
  matching; added after a real false-positive bug (raw-HTML matching caught
  "rtp" inside a base64 blob and a minified JS variable, and "promo code" on
  an ordinary e-commerce checkout) wrongly excluded several of marketing's
  own "good" examples
- `src/filter/businessRelevance.ts` — the AI layer (OpenAI, gpt-4o-mini),
  covers "is this an actual business" including the personal/scholarship
  case; cached per-domain in the new `domain_relevance_cache` table
  (`src/db/schema.ts` / `dashboard/lib/schema.ts`), no expiry (see that
  table's own comment for why that's safe)
- Wired into `src/worker/contactStage.ts` (`checkRelevance`), reusing the
  homepage HTML `src/contact/findContact.ts` already fetches for contact
  lookup (`ContactResult.homepageHtml`, new field) — no extra crawl

Real test results (live domains, not simulated): 28/31 on the deterministic
checks (gambling + institutional) against marketing's 15 examples + the
original 6; 10/10 on the AI layer. Real cost confirmed: $0.000069/domain
(399 input + 15 output tokens on gpt-4o-mini) — roughly $5.50-$11/month at
the user's real volume (80k-160k domains/month), matching the earlier
estimate closely.

Not yet done: a live end-to-end smoke test through a real campaign (everything
so far is proven at the component level, not yet observed running inside an
actual campaign's contact stage) — recommended before calling this fully
deployed.

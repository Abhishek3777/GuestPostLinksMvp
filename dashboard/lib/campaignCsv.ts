// THE one place CSV columns are defined. Both the dashboard's Export button
// and the terminal report scripts build their files through this, so the
// column set for each mode is fixed and cannot drift between them.
//
// Pure and dependency-free (besides pickEmail, equally pure) on purpose, so
// it can be used from both the Next.js app and the worker scripts.

import { pickEmail } from "./pickEmail";

export interface CsvCrawlRow {
  domain: string;
  status: string;
  source: string | null;
  reason: string | null;
  postsProcessed: number;
}

export interface CsvLinkRow {
  sourceDomain: string | null;
  guestPostUrl: string;
  postDate: Date | null;
  externalLink: string;
  rootDomain: string;
  dateFound: Date;
}

export interface CsvProspectRow {
  rootDomain: string;
  exclusionReason: string | null;
  // Set only when exclusionReason is "claimed_by_teammate" — when the OTHER
  // campaign actually claimed it, so the day-count below is computed fresh
  // whenever this is read, not frozen at filter time.
  claimedAt: Date | null;
  claimedByCampaignName: string | null;
  claimedByOwnerEmail: string | null;
  contactStatus: string;
  contactReason: string | null;
  emailAddress: string | null;
  contactFormUrl: string | null;
  finalDomain: string | null;
  contactCheckedAt: Date | null;
}

// "claimed by a teammate 31 days ago (Sangeeta 3 Oct, sangeeta.acgdm@gmail.com)"
// — who and which campaign, so you know exactly who to ask about it. Falls
// back to the old unattributed wording for rows from before this was tracked
// (claimedByCampaignId is null on anything claimed before this column existed).
export function claimedByTeammateNote(claimedAt: Date, campaignName: string | null, ownerEmail: string | null): string {
  const days = Math.max(0, Math.floor((Date.now() - claimedAt.getTime()) / 86_400_000));
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  const who = [campaignName, ownerEmail].filter(Boolean).join(", ");
  return `claimed by a teammate ${when}` + (who ? ` (${who})` : "");
}

export interface CampaignCsvInput {
  mode: "discovery" | "direct";
  contactStageStatus: string;
  domains: string[]; // exactly the domains the user sent
  crawl: CsvCrawlRow[];
  links: CsvLinkRow[];
  prospects: CsvProspectRow[];
}

// --- FULL PIPELINE (discovery): one row per backlink, tracing the whole path
//     input domain -> blog post -> backlink -> contact info -------------------
export const FULL_PIPELINE_COLUMNS = [
  "Input Domain", //          the domain you sent
  "Status", //                Success / Failed / Pending — did we crawl it
  "Failure Type", //          blocked / dns_error / timeout / no_posts_found / error
  "Reason / Notes", //        the specific why (e.g. cloudflare_js_challenge)
  "Discovery Source", //      how posts were found: sitemap / wp-api / feed / html-crawl
  "Posts Processed", //       articles actually read on this domain
  "Blog Post URL", //         the post the backlink was found in
  "Post Date",
  "Backlink URL", //          the outbound link found in that post
  "Backlink Domain", //       who it points to = the prospect
  "Prospect Decision", //     kept, or why it was excluded (do_not_contact, big_brand, ...)
  "Contact Status", //        has_email / form_only / no_contact_found / blocked / ... / not run yet
  "Email",
  "Contact Email", //            which one of (possibly several) Email addresses to actually use
  "Contact Form URL",
  "Contact Notes", //         why contact lookup failed or came back partial
  "Redirects To", //          where the backlink domain redirects, if anywhere
  "Date Found",
] as const;

// What the export dialog pre-ticks for a full-pipeline campaign — the columns
// a salesperson actually works from (what you fed in, the lead, and how to
// reach them). The rest of FULL_PIPELINE_COLUMNS stays one tick away for
// anyone who wants the crawl-process detail too.
export const FULL_PIPELINE_DEFAULT_COLUMNS = [
  "Input Domain",
  "Blog Post URL",
  "Post Date",
  "Backlink URL",
  "Backlink Domain",
  "Email",
  "Contact Email",
  "Contact Form URL",
  "Date Found",
] as const;

// --- DIRECT (Contact Lookup): one row per domain you sent ---------------------
export const DIRECT_COLUMNS = [
  "Input Domain",
  "Status", //                Success (email or form found) / Failed / Excluded / Pending
  "Result", //                has_email / form_only / no_contact_found / blocked / dns_error / timeout / error / or the exclusion reason
  "Reason / Notes",
  "Email",
  "Contact Email",
  "Contact Form URL",
  "Redirects To",
  "Checked At",
] as const;

function csvValue(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// "YYYY-MM-DD HH:mm:ss" — a format Excel recognises as a real date/time
// (raw ISO strings with T/Z/milliseconds show up as unparsed text).
// getHours()/getFullYear() etc. read whatever timezone the SERVER process is
// in (Railway's containers default to UTC), not the reader's — which is why
// this needs its own fixed offset instead of the local-time getters. IST has
// no daylight saving, so a flat +5:30 is always correct, no timezone database
// or Intl support required: shift the instant forward, then read it back with
// the UTC getters (which reflect an absolute instant, not a runtime setting).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "");

function hostOf(url: string): string {
  try {
    return stripWww(new URL(url).hostname);
  } catch {
    return "";
  }
}

// Email Address can hold several candidates, comma-separated (a site's footer,
// header and contact page each surfacing their own address). Contact Email
// picks the one to actually use — ported from pick_email.py (see
// PICK-EMAIL-README.md), which scores by role specifically for guest-post
// PLACEMENT outreach (editor@/guestpost@/submissions@ far outrank info@/
// contact@, since that's who can actually say yes to a post) and rejects
// dead-end mailboxes (noreply@, postmaster@, ...) outright. Hardcoded, not an
// LLM call: this runs once per lead across thousands of leads per campaign, so
// free, instant and the same answer every time matters more than catching
// every last contextual edge case.
function pickBestEmail(emailAddress: string | null | undefined): string {
  const candidates = (emailAddress ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  return pickEmail(candidates).primary ?? "";
}

function toCsv(columns: readonly string[], rows: (string | number | null | undefined)[][]): string {
  // BOM so Excel reads UTF-8 (non-English domains/emails) correctly.
  return "﻿" + [columns.map(csvValue).join(","), ...rows.map((r) => r.map(csvValue).join(","))].join("\r\n");
}

// Rows written before links recorded their source domain have none — recover
// it from the post URL's host by matching it to a domain the user sent.
function sourceOf(link: CsvLinkRow, inputs: string[]): string {
  if (link.sourceDomain) return stripWww(link.sourceDomain);
  const host = hostOf(link.guestPostUrl);
  return inputs.find((d) => host === d || host.endsWith("." + d)) ?? host;
}

export interface CampaignTable {
  columns: readonly string[];
  rows: (string | number | null)[][];
  // Columns that describe a whole GROUP of consecutive rows (e.g. an input domain
  // and its crawl result) and how many rows each group spans. Excel merges them;
  // a CSV leaves them blank after a group's first row.
  groups?: { columns: readonly string[]; sizes: number[] };
}

export function buildCampaignTable(input: CampaignCsvInput): CampaignTable {
  return input.mode === "direct"
    ? { columns: DIRECT_COLUMNS, rows: buildDirectRows(input) }
    : { columns: FULL_PIPELINE_COLUMNS, rows: buildFullPipelineRows(input) };
}

// ---------------------------------------------------------------------------
// UNIQUE EXPORT: the same 17 columns as the full pipeline, with no domain
// repeated (see buildProspectsTable) and no client repeated either — one row
// per client (backlink root domain), showing only its single newest
// guest-post/backlink pair. A client found on several posts is still one
// prospect; listing every page that happened to link to them is process
// detail a reader doesn't need to see repeated.
// ---------------------------------------------------------------------------

type Cell = string | number | null;

function contactCells(p: CsvProspectRow | undefined, contactRan: boolean) {
  const excluded = Boolean(p?.exclusionReason);
  let status = "";
  if (p) {
    if (excluded) status = "not attempted (excluded)";
    else if (p.contactCheckedAt) status = p.contactStatus;
    else status = contactRan ? "pending" : "not run yet";
  }
  // Contact data only exists for kept prospects that were actually checked.
  const found = p && !excluded && p.contactCheckedAt ? p : null;
  const claimNote =
    p?.exclusionReason === "claimed_by_teammate" && p.claimedAt
      ? claimedByTeammateNote(p.claimedAt, p.claimedByCampaignName, p.claimedByOwnerEmail)
      : null;
  return {
    decision: p ? (p.exclusionReason ?? "kept") : "",
    status,
    email: found?.emailAddress ?? "",
    form: found?.contactFormUrl ?? "",
    notes: claimNote ?? found?.contactReason ?? "",
    redirects: found?.finalDomain ?? "",
  };
}

function crawlCells(crawl: CsvCrawlRow | undefined, linkCount: number) {
  const status = !crawl ? "Pending" : crawl.status === "success" ? "Success" : "Failed";
  const failureType = crawl && crawl.status !== "success" ? crawl.status : "";
  let notes = crawl?.reason ?? "";
  if (crawl?.status === "success" && linkCount === 0 && crawl.postsProcessed > 0) {
    notes = [notes, `${crawl.postsProcessed} articles read, but no outbound links found in them`].filter(Boolean).join("; ");
  }
  return { status, failureType, notes, source: crawl?.source ?? "", posts: crawl?.postsProcessed ?? 0 };
}

const newestFirst = (a: CsvLinkRow, b: CsvLinkRow) =>
  (b.postDate?.getTime() ?? 0) - (a.postDate?.getTime() ?? 0) ||
  a.guestPostUrl.localeCompare(b.guestPostUrl) ||
  a.externalLink.localeCompare(b.externalLink);

function uniqueContext(input: CampaignCsvInput) {
  const inputs = [...new Set(input.domains.map(stripWww))];
  const crawlByDomain = new Map(input.crawl.map((c) => [stripWww(c.domain), c]));
  const prospectByDomain = new Map(input.prospects.map((p) => [stripWww(p.rootDomain), p]));
  const contactRan = input.contactStageStatus !== "not_started" && input.contactStageStatus !== "queued";

  const linksBySource = new Map<string, CsvLinkRow[]>();
  const linksByClient = new Map<string, CsvLinkRow[]>();
  for (const l of input.links) {
    const src = sourceOf(l, inputs);
    if (!linksBySource.has(src)) linksBySource.set(src, []);
    linksBySource.get(src)!.push(l);
    const client = stripWww(l.rootDomain);
    if (!linksByClient.has(client)) linksByClient.set(client, []);
    linksByClient.get(client)!.push(l);
  }
  // A source that has links but somehow isn't in the sent list still gets exported.
  const allInputs = [...inputs, ...[...linksBySource.keys()].filter((k) => !inputs.includes(k))];
  return { inputs, allInputs, crawlByDomain, prospectByDomain, contactRan, linksBySource, linksByClient };
}

// Give every client to exactly ONE input domain: the one its newest post is on.
// A client found via several landing pages or several posts on that SAME
// input domain is already one entry here (linksByClient grouped them by root
// domain before this ever runs) — that's what collapses "two URLs, same
// backlink domain" down to one row with no extra work.
interface ClientEntry {
  client: string;
  sorted: CsvLinkRow[];
  posts: number;
  c: ReturnType<typeof contactCells>;
}

function groupClientsByHome({ inputs, prospectByDomain, contactRan, linksByClient }: ReturnType<typeof uniqueContext>) {
  const clientsByHome = new Map<string, ClientEntry[]>();
  for (const [client, links] of linksByClient) {
    const sorted = [...links].sort(newestFirst);
    const home = sourceOf(sorted[0], inputs);
    if (!clientsByHome.has(home)) clientsByHome.set(home, []);
    clientsByHome.get(home)!.push({
      client,
      sorted,
      posts: new Set(links.map((l) => l.guestPostUrl)).size,
      c: contactCells(prospectByDomain.get(client), contactRan),
    });
  }
  return clientsByHome;
}

// A row's bucket: "kept" means an ACTUAL lead — a backlink that is not
// excluded AND actually came back with an email or a contact form. A backlink
// with no contact info yet (pending, nothing found, blocked, failed) is not a
// quality problem to show off in Contacts; it is unfinished work, and goes to
// the No Contact Info sheet alongside domains that found no backlink at all.
// "excluded" is unchanged: a business rule (do-not-contact, big brand,
// claimed by a teammate, ...) says don't pursue it, regardless of contact info.
// Every row is exactly one of the three, never more than one, which is what
// makes the three-way Contacts/Excluded/No Contact Info split possible.
function classify(entry: ClientEntry | undefined): "kept" | "excluded" | "incomplete" {
  if (!entry) return "incomplete";
  if (entry.c.decision !== "kept") return "excluded";
  return entry.c.email || entry.c.form ? "kept" : "incomplete";
}

function rowFor(d: string, cc: ReturnType<typeof crawlCells>, entry: ClientEntry | undefined): Cell[] {
  const head: Cell[] = [d, cc.status, cc.failureType, cc.notes, cc.source, cc.posts];
  if (!entry) return [...head, "", "", "", "", "no_backlinks_found", "", "", "", "", "", "", ""];
  const { sorted, c } = entry;
  const top = sorted[0];
  return [
    ...head,
    top.guestPostUrl,
    fmtDate(top.postDate),
    top.externalLink,
    top.rootDomain,
    c.decision,
    c.status,
    c.email,
    pickBestEmail(c.email),
    c.form,
    c.notes,
    c.redirects,
    fmtDate(top.dateFound),
  ];
}

// Every row this campaign can produce, one per unique backlink domain homed
// to its input domain (not one row per input domain) — an input domain that
// found 800 distinct backlinks produces 800 rows, each classified on its OWN
// status, not collapsed into a single "best" pick. An input domain with no
// backlinks at all still gets exactly one row, same as before.
function buildAllRows(input: CampaignCsvInput): { bucket: "kept" | "excluded" | "incomplete"; row: Cell[] }[] {
  const ctx = uniqueContext(input);
  const { allInputs, crawlByDomain, linksBySource } = ctx;
  const clientsByHome = groupClientsByHome(ctx);

  const out: { bucket: "kept" | "excluded" | "incomplete"; row: Cell[] }[] = [];
  for (const d of allInputs) {
    const cc = crawlCells(crawlByDomain.get(d), linksBySource.get(d)?.length ?? 0);
    const entries = clientsByHome.get(d) ?? [];

    if (entries.length === 0) {
      out.push({ bucket: "incomplete", row: rowFor(d, cc, undefined) });
      continue;
    }
    for (const entry of entries) {
      out.push({ bucket: classify(entry), row: rowFor(d, cc, entry) });
    }
  }
  return out;
}

export function buildProspectsTable(input: CampaignCsvInput, filter: "all" | "kept" | "excluded" = "all"): CampaignTable {
  const all = buildAllRows(input);
  const rows = (filter === "all" ? all : all.filter((r) => r.bucket === filter)).map((r) => r.row);
  return { columns: FULL_PIPELINE_COLUMNS, rows };
}

// Everything that isn't a clean, actionable lead: no backlink found at all, OR
// a backlink that's kept (not excluded) but came back with no email and no
// contact form — pending lookup, nothing found, blocked, or failed. Split out
// of Contacts so that sheet only ever shows rows with real contact info, same
// shape the reference file this was matched against uses.
export function buildNoBacklinksTable(input: CampaignCsvInput): CampaignTable {
  const rows = buildAllRows(input)
    .filter((r) => r.bucket === "incomplete")
    .map((r) => r.row);
  return { columns: FULL_PIPELINE_COLUMNS, rows };
}

// Keeps only the wanted columns (in the table's own order). Null when none of
// them exist in this table, so callers can drop or fall back.
export function selectColumns(table: CampaignTable, wanted: readonly string[]): CampaignTable | null {
  const keep = table.columns.map((c, i) => (wanted.includes(c) ? i : -1)).filter((i) => i >= 0);
  if (keep.length === 0) return null;
  return {
    columns: keep.map((i) => table.columns[i]),
    rows: table.rows.map((r) => keep.map((i) => r[i])),
    groups: table.groups && {
      columns: table.groups.columns.filter((c) => wanted.includes(c)),
      sizes: table.groups.sizes,
    },
  };
}

export function buildTableCsv(table: CampaignTable): string {
  const groups = table.groups;
  if (!groups) return toCsv(table.columns, table.rows);

  const grouped = new Set(table.columns.map((c, i) => (groups.columns.includes(c) ? i : -1)).filter((i) => i >= 0));
  const rows: (string | number | null)[][] = [];
  let at = 0;
  for (const size of groups.sizes) {
    for (let k = 0; k < size; k++, at++) {
      const row = table.rows[at];
      rows.push(k === 0 ? row : row.map((v, i) => (grouped.has(i) ? "" : v)));
    }
  }
  return toCsv(table.columns, rows);
}

export function buildCampaignCsv(input: CampaignCsvInput): string {
  const { columns, rows } = buildCampaignTable(input);
  return toCsv(columns, rows);
}

function buildFullPipelineRows(input: CampaignCsvInput): (string | number | null)[][] {
  const inputs = [...new Set(input.domains.map(stripWww))];
  const crawlByDomain = new Map(input.crawl.map((c) => [stripWww(c.domain), c]));
  const prospectByDomain = new Map(input.prospects.map((p) => [stripWww(p.rootDomain), p]));
  const contactRan = input.contactStageStatus !== "not_started" && input.contactStageStatus !== "queued";

  const linksBySource = new Map<string, CsvLinkRow[]>();
  for (const l of input.links) {
    const src = sourceOf(l, inputs);
    if (!linksBySource.has(src)) linksBySource.set(src, []);
    linksBySource.get(src)!.push(l);
  }

  const rows: (string | number | null)[][] = [];

  // Any input domain that has links but somehow isn't in the sent list still
  // gets exported rather than silently dropped.
  const allDomains = [...inputs, ...[...linksBySource.keys()].filter((k) => !inputs.includes(k))];

  for (const d of allDomains) {
    const crawl = crawlByDomain.get(d);
    const links = (linksBySource.get(d) ?? []).sort(
      (a, b) =>
        (b.postDate?.getTime() ?? 0) - (a.postDate?.getTime() ?? 0) ||
        a.guestPostUrl.localeCompare(b.guestPostUrl) ||
        a.externalLink.localeCompare(b.externalLink)
    );

    const status = !crawl ? "Pending" : crawl.status === "success" ? "Success" : "Failed";
    const failureType = crawl && crawl.status !== "success" ? crawl.status : "";
    let notes = crawl?.reason ?? "";
    if (crawl?.status === "success" && links.length === 0 && crawl.postsProcessed > 0) {
      notes = [notes, `${crawl.postsProcessed} articles read, but no outbound links found in them`].filter(Boolean).join("; ");
    }
    const head = [d, status, failureType, notes, crawl?.source ?? "", crawl?.postsProcessed ?? 0];

    if (links.length === 0) {
      rows.push([...head, "", "", "", "", "", "", "", "", "", "", "", ""]);
      continue;
    }

    for (const l of links) {
      const p = prospectByDomain.get(stripWww(l.rootDomain));
      const excluded = Boolean(p?.exclusionReason);
      const decision = p ? (p.exclusionReason ?? "kept") : "";

      let contactStatus = "";
      if (p) {
        if (excluded) contactStatus = "not attempted (excluded)";
        else if (p.contactCheckedAt) contactStatus = p.contactStatus;
        else contactStatus = contactRan ? "pending" : "not run yet";
      }

      // Contact data only exists for kept prospects that were actually checked.
      const contact = p && !excluded && p.contactCheckedAt ? p : null;
      rows.push([
        ...head,
        l.guestPostUrl,
        fmtDate(l.postDate),
        l.externalLink,
        l.rootDomain,
        decision,
        contactStatus,
        contact?.emailAddress ?? "",
        pickBestEmail(contact?.emailAddress),
        contact?.contactFormUrl ?? "",
        contact?.contactReason ?? "",
        contact?.finalDomain ?? "",
        fmtDate(l.dateFound),
      ]);
    }
  }

  return rows;
}

function buildDirectRows(input: CampaignCsvInput): (string | number | null)[][] {
  const inputs = [...new Set(input.domains.map(stripWww))];
  const prospectByDomain = new Map(input.prospects.map((p) => [stripWww(p.rootDomain), p]));

  const rows = inputs.map((d) => {
    const p = prospectByDomain.get(d);
    if (!p) return [d, "Pending", "pending", "", "", "", "", "", ""];

    if (p.exclusionReason) {
      return [d, "Excluded", p.exclusionReason, "excluded at the filter stage — no contact lookup attempted", "", "", "", "", ""];
    }
    if (!p.contactCheckedAt) return [d, "Pending", "pending", "", "", "", "", "", ""];

    const found = p.contactStatus === "has_email" || p.contactStatus === "form_only";
    return [
      d,
      found ? "Success" : "Failed",
      p.contactStatus,
      p.contactReason ?? "",
      p.emailAddress ?? "",
      pickBestEmail(p.emailAddress),
      p.contactFormUrl ?? "",
      p.finalDomain ?? "",
      fmtDate(p.contactCheckedAt),
    ];
  });

  return rows;
}

"use strict";
// THE one place CSV columns are defined. Both the dashboard's Export button
// and the terminal report scripts build their files through this, so the
// column set for each mode is fixed and cannot drift between them.
//
// Pure and dependency-free on purpose (no imports) so it can be used from
// both the Next.js app and the worker scripts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECT_HIGHLIGHT = exports.FULL_PIPELINE_HIGHLIGHT = exports.DIRECT_COLUMNS = exports.FULL_PIPELINE_COLUMNS = void 0;
exports.buildCampaignTable = buildCampaignTable;
exports.buildProspectsTable = buildProspectsTable;
exports.selectColumns = selectColumns;
exports.buildTableCsv = buildTableCsv;
exports.buildCampaignCsv = buildCampaignCsv;
// --- FULL PIPELINE (discovery): one row per backlink, tracing the whole path
//     input domain -> blog post -> backlink -> contact info -------------------
exports.FULL_PIPELINE_COLUMNS = [
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
    "Contact Form URL",
    "Contact Notes", //         why contact lookup failed or came back partial
    "Redirects To", //          where the backlink domain redirects, if anywhere
    "Date Found",
];
// --- DIRECT (Contact Lookup): one row per domain you sent ---------------------
exports.DIRECT_COLUMNS = [
    "Input Domain",
    "Status", //                Success (email or form found) / Failed / Excluded / Pending
    "Result", //                has_email / form_only / no_contact_found / blocked / dns_error / timeout / error / or the exclusion reason
    "Reason / Notes",
    "Email",
    "Contact Form URL",
    "Redirects To",
    "Checked At",
];
function csvValue(v) {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// "YYYY-MM-DD HH:mm:ss" — a format Excel recognises as a real date/time
// (raw ISO strings with T/Z/milliseconds show up as unparsed text).
function fmtDate(d) {
    if (!d)
        return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const stripWww = (h) => h.toLowerCase().replace(/^www\./, "");
function hostOf(url) {
    try {
        return stripWww(new URL(url).hostname);
    }
    catch {
        return "";
    }
}
function toCsv(columns, rows) {
    // BOM so Excel reads UTF-8 (non-English domains/emails) correctly.
    return "﻿" + [columns.map(csvValue).join(","), ...rows.map((r) => r.map(csvValue).join(","))].join("\r\n");
}
// Rows written before links recorded their source domain have none — recover
// it from the post URL's host by matching it to a domain the user sent.
function sourceOf(link, inputs) {
    if (link.sourceDomain)
        return stripWww(link.sourceDomain);
    const host = hostOf(link.guestPostUrl);
    return inputs.find((d) => host === d || host.endsWith("." + d)) ?? host;
}
// The columns a reader should see first: the real domains, guest post URLs and
// contact details. The .xlsx export highlights these; the CSV can't carry
// formatting, so it just has the same columns unstyled.
exports.FULL_PIPELINE_HIGHLIGHT = [
    "Input Domain",
    "Blog Post URL",
    "Backlink Domain",
    "Email",
    "Contact Form URL",
];
exports.DIRECT_HIGHLIGHT = ["Input Domain", "Email", "Contact Form URL"];
function buildCampaignTable(input) {
    return input.mode === "direct"
        ? { columns: exports.DIRECT_COLUMNS, rows: buildDirectRows(input), highlight: exports.DIRECT_HIGHLIGHT }
        : { columns: exports.FULL_PIPELINE_COLUMNS, rows: buildFullPipelineRows(input), highlight: exports.FULL_PIPELINE_HIGHLIGHT };
}
// One value per line. If only SOME lines are blank they become "-", so the
// lines stay lined up with the other columns; all-blank stays empty.
function lines(values) {
    const v = values.map((x) => (x === null || x === undefined ? "" : String(x)));
    return v.every((x) => x === "") ? "" : v.map((x) => x || "-").join("\n");
}
// A single value stays a real value (so numbers stay numbers in Excel).
function cell(values) {
    return values.length === 1 ? (values[0] ?? "") : lines(values);
}
// The same value on every line collapses to one (e.g. a Date Found shared by
// the whole crawl).
function collapseSame(values) {
    return values.every((v) => v === values[0]) ? (values[0] ?? "") : lines(values);
}
function contactCells(p, contactRan) {
    const excluded = Boolean(p?.exclusionReason);
    let status = "";
    if (p) {
        if (excluded)
            status = "not attempted (excluded)";
        else if (p.contactCheckedAt)
            status = p.contactStatus;
        else
            status = contactRan ? "pending" : "not run yet";
    }
    // Contact data only exists for kept prospects that were actually checked.
    const found = p && !excluded && p.contactCheckedAt ? p : null;
    return {
        decision: p ? (p.exclusionReason ?? "kept") : "",
        status,
        email: found?.emailAddress ?? "",
        form: found?.contactFormUrl ?? "",
        notes: found?.contactReason ?? "",
        redirects: found?.finalDomain ?? "",
    };
}
function crawlCells(crawl, linkCount) {
    const status = !crawl ? "Pending" : crawl.status === "success" ? "Success" : "Failed";
    const failureType = crawl && crawl.status !== "success" ? crawl.status : "";
    let notes = crawl?.reason ?? "";
    if (crawl?.status === "success" && linkCount === 0 && crawl.postsProcessed > 0) {
        notes = [notes, `${crawl.postsProcessed} articles read, but no outbound links found in them`].filter(Boolean).join("; ");
    }
    return { status, failureType, notes, source: crawl?.source ?? "", posts: crawl?.postsProcessed ?? 0 };
}
const newestFirst = (a, b) => (b.postDate?.getTime() ?? 0) - (a.postDate?.getTime() ?? 0) ||
    a.guestPostUrl.localeCompare(b.guestPostUrl) ||
    a.externalLink.localeCompare(b.externalLink);
const contactRank = (status) => (status === "has_email" ? 0 : status === "form_only" ? 1 : 2);
function uniqueContext(input) {
    const inputs = [...new Set(input.domains.map(stripWww))];
    const crawlByDomain = new Map(input.crawl.map((c) => [stripWww(c.domain), c]));
    const prospectByDomain = new Map(input.prospects.map((p) => [stripWww(p.rootDomain), p]));
    const contactRan = input.contactStageStatus !== "not_started" && input.contactStageStatus !== "queued";
    const linksBySource = new Map();
    const linksByClient = new Map();
    for (const l of input.links) {
        const src = sourceOf(l, inputs);
        if (!linksBySource.has(src))
            linksBySource.set(src, []);
        linksBySource.get(src).push(l);
        const client = stripWww(l.rootDomain);
        if (!linksByClient.has(client))
            linksByClient.set(client, []);
        linksByClient.get(client).push(l);
    }
    // A source that has links but somehow isn't in the sent list still gets exported.
    const allInputs = [...inputs, ...[...linksBySource.keys()].filter((k) => !inputs.includes(k))];
    return { inputs, allInputs, crawlByDomain, prospectByDomain, contactRan, linksBySource, linksByClient };
}
// One sheet, grouped by INPUT DOMAIN. Each domain you sent appears once (its
// crawl columns are merged across its rows in Excel, blank after the first row
// in a CSV), with its backlink domains listed under it. Each backlink domain
// (client) appears once too: it sits under the input domain its newest post is
// on. Everything else about the client, including posts on any other input
// domain, its emails and its forms, stays in its own row, one value per line.
// Input domains that produced no backlinks get a row of their own so every
// domain you sent is still accounted for.
const INPUT_LEVEL_COLUMNS = [
    "Input Domain",
    "Status",
    "Failure Type",
    "Reason / Notes",
    "Discovery Source",
    "Posts Processed",
];
function buildProspectsTable(input) {
    const { inputs, allInputs, crawlByDomain, prospectByDomain, contactRan, linksBySource, linksByClient } = uniqueContext(input);
    // Give every client to exactly ONE input domain: the one its newest post is on.
    const clientsByHome = new Map();
    for (const [client, links] of linksByClient) {
        const sorted = [...links].sort(newestFirst);
        const home = sourceOf(sorted[0], inputs);
        if (!clientsByHome.has(home))
            clientsByHome.set(home, []);
        clientsByHome.get(home).push({
            client,
            sorted,
            posts: new Set(links.map((l) => l.guestPostUrl)).size,
            c: contactCells(prospectByDomain.get(client), contactRan),
        });
    }
    const rows = [];
    const sizes = [];
    for (const d of allInputs) {
        const cc = crawlCells(crawlByDomain.get(d), linksBySource.get(d)?.length ?? 0);
        const head = [d, cc.status, cc.failureType, cc.notes, cc.source, cc.posts];
        // Contactable first (email, then form-only); within a group, the clients
        // seen on the most guest posts first, since a domain that keeps buying
        // links is the warmest lead.
        const clients = (clientsByHome.get(d) ?? []).sort((a, b) => contactRank(a.c.status) - contactRank(b.c.status) || b.posts - a.posts || a.client.localeCompare(b.client));
        if (clients.length === 0) {
            rows.push([...head, "", "", "", "", "", "", "", "", "", "", ""]);
            sizes.push(1);
            continue;
        }
        for (const { sorted, c } of clients) {
            rows.push([
                ...head,
                cell(sorted.map((l) => l.guestPostUrl)),
                cell(sorted.map((l) => fmtDate(l.postDate))),
                cell(sorted.map((l) => l.externalLink)),
                sorted[0].rootDomain,
                c.decision,
                c.status,
                c.email,
                c.form,
                c.notes,
                c.redirects,
                collapseSame(sorted.map((l) => fmtDate(l.dateFound))),
            ]);
        }
        sizes.push(clients.length);
    }
    return {
        columns: exports.FULL_PIPELINE_COLUMNS,
        rows,
        highlight: exports.FULL_PIPELINE_HIGHLIGHT,
        groups: { columns: INPUT_LEVEL_COLUMNS, sizes },
    };
}
// Keeps only the wanted columns (in the table's own order). Null when none of
// them exist in this table, so callers can drop or fall back.
function selectColumns(table, wanted) {
    const keep = table.columns.map((c, i) => (wanted.includes(c) ? i : -1)).filter((i) => i >= 0);
    if (keep.length === 0)
        return null;
    return {
        columns: keep.map((i) => table.columns[i]),
        rows: table.rows.map((r) => keep.map((i) => r[i])),
        highlight: table.highlight.filter((h) => wanted.includes(h)),
        groups: table.groups && {
            columns: table.groups.columns.filter((c) => wanted.includes(c)),
            sizes: table.groups.sizes,
        },
    };
}
function buildTableCsv(table) {
    const groups = table.groups;
    if (!groups)
        return toCsv(table.columns, table.rows);
    const grouped = new Set(table.columns.map((c, i) => (groups.columns.includes(c) ? i : -1)).filter((i) => i >= 0));
    const rows = [];
    let at = 0;
    for (const size of groups.sizes) {
        for (let k = 0; k < size; k++, at++) {
            const row = table.rows[at];
            rows.push(k === 0 ? row : row.map((v, i) => (grouped.has(i) ? "" : v)));
        }
    }
    return toCsv(table.columns, rows);
}
function buildCampaignCsv(input) {
    const { columns, rows } = buildCampaignTable(input);
    return toCsv(columns, rows);
}
function buildFullPipelineRows(input) {
    const inputs = [...new Set(input.domains.map(stripWww))];
    const crawlByDomain = new Map(input.crawl.map((c) => [stripWww(c.domain), c]));
    const prospectByDomain = new Map(input.prospects.map((p) => [stripWww(p.rootDomain), p]));
    const contactRan = input.contactStageStatus !== "not_started" && input.contactStageStatus !== "queued";
    const linksBySource = new Map();
    for (const l of input.links) {
        const src = sourceOf(l, inputs);
        if (!linksBySource.has(src))
            linksBySource.set(src, []);
        linksBySource.get(src).push(l);
    }
    const rows = [];
    // Any input domain that has links but somehow isn't in the sent list still
    // gets exported rather than silently dropped.
    const allDomains = [...inputs, ...[...linksBySource.keys()].filter((k) => !inputs.includes(k))];
    for (const d of allDomains) {
        const crawl = crawlByDomain.get(d);
        const links = (linksBySource.get(d) ?? []).sort((a, b) => (b.postDate?.getTime() ?? 0) - (a.postDate?.getTime() ?? 0) ||
            a.guestPostUrl.localeCompare(b.guestPostUrl) ||
            a.externalLink.localeCompare(b.externalLink));
        const status = !crawl ? "Pending" : crawl.status === "success" ? "Success" : "Failed";
        const failureType = crawl && crawl.status !== "success" ? crawl.status : "";
        let notes = crawl?.reason ?? "";
        if (crawl?.status === "success" && links.length === 0 && crawl.postsProcessed > 0) {
            notes = [notes, `${crawl.postsProcessed} articles read, but no outbound links found in them`].filter(Boolean).join("; ");
        }
        const head = [d, status, failureType, notes, crawl?.source ?? "", crawl?.postsProcessed ?? 0];
        if (links.length === 0) {
            rows.push([...head, "", "", "", "", "", "", "", "", "", "", ""]);
            continue;
        }
        for (const l of links) {
            const p = prospectByDomain.get(stripWww(l.rootDomain));
            const excluded = Boolean(p?.exclusionReason);
            const decision = p ? (p.exclusionReason ?? "kept") : "";
            let contactStatus = "";
            if (p) {
                if (excluded)
                    contactStatus = "not attempted (excluded)";
                else if (p.contactCheckedAt)
                    contactStatus = p.contactStatus;
                else
                    contactStatus = contactRan ? "pending" : "not run yet";
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
                contact?.contactFormUrl ?? "",
                contact?.contactReason ?? "",
                contact?.finalDomain ?? "",
                fmtDate(l.dateFound),
            ]);
        }
    }
    return rows;
}
function buildDirectRows(input) {
    const inputs = [...new Set(input.domains.map(stripWww))];
    const prospectByDomain = new Map(input.prospects.map((p) => [stripWww(p.rootDomain), p]));
    const rows = inputs.map((d) => {
        const p = prospectByDomain.get(d);
        if (!p)
            return [d, "Pending", "pending", "", "", "", "", ""];
        if (p.exclusionReason) {
            return [d, "Excluded", p.exclusionReason, "excluded at the filter stage — no contact lookup attempted", "", "", "", ""];
        }
        if (!p.contactCheckedAt)
            return [d, "Pending", "pending", "", "", "", "", ""];
        const found = p.contactStatus === "has_email" || p.contactStatus === "form_only";
        return [
            d,
            found ? "Success" : "Failed",
            p.contactStatus,
            p.contactReason ?? "",
            p.emailAddress ?? "",
            p.contactFormUrl ?? "",
            p.finalDomain ?? "",
            fmtDate(p.contactCheckedAt),
        ];
    });
    return rows;
}

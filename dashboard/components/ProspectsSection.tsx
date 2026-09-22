"use client";

import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { ProportionBar, type Segment } from "./ProportionBar";

const REASON_LABEL: Record<string, string> = {
  do_not_contact: "Do not contact",
  gov_edu_tld: "Gov/edu/mil",
  big_brand: "Big brand",
  excluded_domain: "Excluded domain",
  parked_domain: "Parked domain",
  url_shortener: "URL shortener",
  invalid_domain: "Invalid domain",
};

interface Prospect {
  id: string;
  rootDomain: string;
  exampleGuestPostUrl: string | null;
  exclusionReason: string | null;
  contactStatus: string;
  contactReason: string | null;
  emailAddress: string | null;
  contactFormUrl: string | null;
}

// Contact-status filters. Each is a plain question about a kept lead, so the chips
// and their counts always agree with what the table shows.
type ContactFilter = "has_email" | "has_form" | "both" | "form_only" | "none" | "blocked" | "failed" | "pending";

const CONTACT_FILTERS: { key: ContactFilter; label: string; test: (p: Prospect) => boolean }[] = [
  { key: "has_email", label: "Has email", test: (p) => Boolean(p.emailAddress) },
  { key: "has_form", label: "Has contact form", test: (p) => Boolean(p.contactFormUrl) },
  { key: "both", label: "Email + form", test: (p) => Boolean(p.emailAddress && p.contactFormUrl) },
  { key: "form_only", label: "Form only (no email)", test: (p) => p.contactStatus === "form_only" },
  { key: "none", label: "Nothing found", test: (p) => p.contactStatus === "no_contact_found" },
  { key: "blocked", label: "Blocked", test: (p) => p.contactStatus === "blocked" },
  { key: "failed", label: "Failed (timeout / DNS / error)", test: (p) => ["timeout", "dns_error", "error"].includes(p.contactStatus) },
  { key: "pending", label: "Not looked up yet", test: (p) => p.contactStatus === "pending" },
];

export function ProspectsSection({ prospects, contactStageStarted }: { prospects: Prospect[]; contactStageStarted: boolean }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [contactFilter, setContactFilter] = useState<ContactFilter | null>(null);
  const [search, setSearch] = useState("");

  const keptCount = prospects.filter((p) => !p.exclusionReason).length;
  const excludedCount = prospects.length - keptCount;

  const reasonCounts = new Map<string, number>();
  for (const p of prospects) {
    const key = p.exclusionReason ?? "kept";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const segments: Segment[] = [...reasonCounts.entries()].map(([key, value]) => ({
    key,
    label: key === "kept" ? "kept" : REASON_LABEL[key] ?? key,
    value,
    tone: key === "kept" ? "success" : "warning",
  }));

  // Counts are over KEPT leads only: an excluded prospect never gets a contact lookup.
  const kept = prospects.filter((p) => !p.exclusionReason);
  const contactCounts = new Map(CONTACT_FILTERS.map((f) => [f.key, kept.filter(f.test).length]));
  const activeContact = CONTACT_FILTERS.find((f) => f.key === contactFilter) ?? null;
  const needle = search.trim().toLowerCase();

  const rows = prospects.filter((p) => {
    if (filter && (p.exclusionReason ?? "kept") !== filter) return false;
    if (activeContact && (p.exclusionReason || !activeContact.test(p))) return false;
    if (needle && !p.rootDomain.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-medium text-text">
          Prospect breakdown <span className="font-normal text-muted">— click a segment to filter below</span>
        </h2>
        <ProportionBar segments={segments} onSegmentClick={(key) => setFilter((cur) => (cur === key ? null : key))} activeKey={filter} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Prospects ({keptCount} kept · {excludedCount} excluded)
          {filter && <span className="normal-case text-accent"> — filtered: {filter === "kept" ? "kept" : REASON_LABEL[filter] ?? filter}</span>}
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {contactStageStarted ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setContactFilter(null)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  !contactFilter ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
                }`}
              >
                All contact results
              </button>
              {CONTACT_FILTERS.filter((f) => (contactCounts.get(f.key) ?? 0) > 0).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setContactFilter((cur) => (cur === f.key ? null : f.key))}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    contactFilter === f.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
                  }`}
                >
                  {f.label} · {contactCounts.get(f.key)}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search domain"
            className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
          />
        </div>
        {(contactFilter || needle) && (
          <p className="text-xs text-muted">
            Showing {rows.length} of {prospects.length}. Filters only change this view — Export still includes everything.
          </p>
        )}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-5 py-3">Root domain</th>
                <th className="px-5 py-3">Decision</th>
                {contactStageStarted && (
                  <>
                    <th className="px-5 py-3">Contact status</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Contact form</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-5 py-3 font-medium text-text">{p.rootDomain}</td>
                  <td className="px-5 py-3">
                    {p.exclusionReason ? (
                      <StatusBadge status={p.exclusionReason} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" /> kept
                      </span>
                    )}
                  </td>
                  {contactStageStarted && (
                    <>
                      <td className="px-5 py-3">
                        {p.exclusionReason ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={p.contactStatus} />
                            {p.contactReason && (
                              <span className="max-w-[240px] truncate text-[11px] text-muted" title={p.contactReason}>
                                {p.contactReason}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3 font-mono text-[13px] text-text">
                        {p.emailAddress ?? <span className="font-sans text-muted">—</span>}
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3 font-mono text-[13px]">
                        {p.contactFormUrl ? (
                          <a href={p.contactFormUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-accent hover:underline">
                            {p.contactFormUrl}
                          </a>
                        ) : (
                          <span className="font-sans text-muted">—</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={contactStageStarted ? 5 : 2} className="px-5 py-10 text-center text-muted">
                    No prospects match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

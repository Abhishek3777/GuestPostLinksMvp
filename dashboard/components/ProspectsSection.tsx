"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { ProportionBar, type Segment } from "./ProportionBar";
import { claimedByTeammateNote } from "@/lib/campaignCsv";
import type { ContactFilterKey } from "@/services/campaigns.service";

const REASON_LABEL: Record<string, string> = {
  do_not_contact: "Do not contact",
  gov_edu_tld: "Gov/edu/mil",
  big_brand: "Big brand",
  excluded_domain: "Excluded domain",
  parked_domain: "Parked domain",
  url_shortener: "URL shortener",
  invalid_domain: "Invalid domain",
};

const CONTACT_FILTER_LABEL: Record<ContactFilterKey, string> = {
  has_email: "Has email",
  has_form: "Has contact form",
  both: "Email + form",
  form_only: "Form only (no email)",
  none: "Nothing found",
  blocked: "Blocked",
  failed: "Failed (timeout / DNS / error)",
  pending: "Not looked up yet",
};

interface Prospect {
  id: string;
  rootDomain: string;
  exampleGuestPostUrl: string | null;
  exclusionReason: string | null;
  claimedAt: Date | null;
  claimedByCampaignName: string | null;
  claimedByOwnerEmail: string | null;
  contactStatus: string;
  contactReason: string | null;
  emailAddress: string | null;
  contactFormUrl: string | null;
}

// Rows are a single bounded page from the server (getCampaignProspectsPage) —
// every filter (reason segment, contact chip, search box) and the pager work
// by navigating to a new URL, not by holding every prospect in the browser.
export function ProspectsSection({
  rows,
  reasonCounts,
  contactFilterCounts,
  total,
  page,
  pageCount,
  contactStageStarted,
}: {
  rows: Prospect[];
  reasonCounts: { reason: string | null; count: number }[];
  contactFilterCounts?: Record<ContactFilterKey, number>;
  total: number;
  page: number;
  pageCount: number;
  contactStageStarted: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const reasonFilter = params.get("preason");
  const contactFilter = params.get("pcontact") as ContactFilterKey | null;
  const [search, setSearch] = useState(params.get("psearch") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const keptCount = reasonCounts.find((r) => r.reason === null)?.count ?? 0;
  const excludedCount = reasonCounts.reduce((sum, r) => sum + (r.reason === null ? 0 : r.count), 0);

  const segments: Segment[] = reasonCounts.map(({ reason, count }) => ({
    key: reason ?? "kept",
    label: reason === null ? "kept" : REASON_LABEL[reason] ?? reason,
    value: count,
    tone: reason === null ? "success" : "warning",
  }));

  function hrefFor(next: { preason?: string | null; pcontact?: string | null; psearch?: string | null; ppage?: number }) {
    const p = new URLSearchParams(params.toString());
    if (next.preason !== undefined) {
      if (next.preason) p.set("preason", next.preason);
      else p.delete("preason");
    }
    if (next.pcontact !== undefined) {
      if (next.pcontact) p.set("pcontact", next.pcontact);
      else p.delete("pcontact");
    }
    if (next.psearch !== undefined) {
      if (next.psearch) p.set("psearch", next.psearch);
      else p.delete("psearch");
    }
    if (next.ppage !== undefined && next.ppage > 1) p.set("ppage", String(next.ppage));
    else p.delete("ppage");
    const qs = p.toString();
    return qs ? `?${qs}` : "?";
  }

  function toggleReason(key: string) {
    router.push(hrefFor({ preason: reasonFilter === key ? null : key, ppage: 1 }));
  }

  function toggleContact(key: ContactFilterKey) {
    router.push(hrefFor({ pcontact: contactFilter === key ? null : key, ppage: 1 }));
  }

  function onSearch(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.push(hrefFor({ psearch: value.trim() || null, ppage: 1 })), 350);
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-medium text-text">
          Prospect breakdown <span className="font-normal text-muted">— click a segment to filter below</span>
        </h2>
        <ProportionBar segments={segments} onSegmentClick={toggleReason} activeKey={reasonFilter} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Prospects ({keptCount.toLocaleString()} kept · {excludedCount.toLocaleString()} excluded)
          {reasonFilter && (
            <span className="normal-case text-accent">
              {" "}
              — filtered: {reasonFilter === "kept" ? "kept" : REASON_LABEL[reasonFilter] ?? reasonFilter}
            </span>
          )}
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {contactStageStarted && contactFilterCounts ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => toggleContact(contactFilter as ContactFilterKey)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  !contactFilter ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
                }`}
              >
                All contact results
              </button>
              {(Object.keys(CONTACT_FILTER_LABEL) as ContactFilterKey[])
                .filter((k) => contactFilterCounts[k] > 0)
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => toggleContact(k)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      contactFilter === k ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
                    }`}
                  >
                    {CONTACT_FILTER_LABEL[k]} · {contactFilterCounts[k]}
                  </button>
                ))}
            </div>
          ) : (
            <span />
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search domain"
              className="w-56 rounded-lg border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
            />
          </div>
        </div>
        {(contactFilter || search) && (
          <p className="text-xs text-muted">Showing {total.toLocaleString()} matching. Filters only change this view — Export still includes everything.</p>
        )}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
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
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={p.exclusionReason} />
                          {p.exclusionReason === "claimed_by_teammate" && p.claimedAt && (
                            <span className="text-[11px] text-muted">
                              {claimedByTeammateNote(new Date(p.claimedAt), p.claimedByCampaignName, p.claimedByOwnerEmail)}
                            </span>
                          )}
                        </div>
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
                        <td className="max-w-[220px] break-all px-5 py-3 font-mono text-[13px] text-text">
                          {p.emailAddress ?? <span className="font-sans text-muted">—</span>}
                        </td>
                        <td className="max-w-[280px] break-all px-5 py-3 font-mono text-[13px]">
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
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Page {page} of {pageCount}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => router.push(hrefFor({ ppage: page - 1 }))}
                disabled={page <= 1}
                className={`rounded-lg border border-border px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
              >
                Previous
              </button>
              <button
                onClick={() => router.push(hrefFor({ ppage: page + 1 }))}
                disabled={page >= pageCount}
                className={`rounded-lg border border-border px-3 py-1.5 ${page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

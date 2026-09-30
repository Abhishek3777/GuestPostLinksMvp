"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "./StatusBadge";
import { ProportionBar, type Segment } from "./ProportionBar";

const STATUS_TONE: Record<string, Segment["tone"]> = {
  success: "success",
  blocked: "warning",
  no_posts_found: "warning",
  dns_error: "danger",
  timeout: "danger",
  error: "danger",
};

interface DomainStatus {
  id: string;
  domain: string;
  status: string;
  source: string | null;
  reason: string | null;
  postsProcessed: number;
}

// Rows are a single bounded page from the server (see getCampaignDomainStatusesPage) —
// filtering and paging both happen by navigating to a new URL (?dstatus=, ?dpage=),
// not by holding every row in the browser and slicing it client-side.
export function DomainStatusSection({
  rows,
  statusCounts,
  total,
  page,
  pageCount,
  isLive,
}: {
  rows: DomainStatus[];
  statusCounts: { status: string; count: number }[];
  total: number;
  page: number;
  pageCount: number;
  isLive: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const filter = params.get("dstatus");

  const segments: Segment[] = statusCounts.map(({ status, count }) => ({
    key: status,
    label: status.replace(/_/g, " "),
    value: count,
    tone: STATUS_TONE[status] ?? "neutral",
  }));

  function hrefFor(next: { dstatus?: string | null; dpage?: number }) {
    const p = new URLSearchParams(params.toString());
    if (next.dstatus !== undefined) {
      if (next.dstatus) p.set("dstatus", next.dstatus);
      else p.delete("dstatus");
      p.delete("dpage");
    }
    if (next.dpage !== undefined) {
      if (next.dpage > 1) p.set("dpage", String(next.dpage));
      else p.delete("dpage");
    }
    const qs = p.toString();
    return qs ? `?${qs}` : "?";
  }

  function toggleFilter(key: string) {
    router.push(hrefFor({ dstatus: filter === key ? null : key }));
  }

  const grandTotal = statusCounts.reduce((sum, s) => sum + s.count, 0);

  return (
    <>
      {grandTotal > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-medium text-text">
            Domain outcome breakdown <span className="font-normal text-muted">— click a segment to see why</span>
          </h2>
          <ProportionBar segments={segments} onSegmentClick={toggleFilter} activeKey={filter} />
        </div>
      )}

      {grandTotal > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Domain status (Stage 1) {filter && <span className="normal-case text-accent">— filtered: {filter.replace(/_/g, " ")}</span>}
            </h2>
            <span className="text-xs text-muted">{total.toLocaleString()} domain(s)</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Domain</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3">Posts processed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-3 font-medium text-text">{d.domain}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-5 py-3 text-muted">{d.source ?? "—"}</td>
                    <td className="max-w-xs truncate px-5 py-3 font-mono text-[12px] text-muted" title={d.reason ?? undefined}>
                      {d.reason?.replace("homepage probe: ", "") ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-muted">{d.postsProcessed}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      {isLive ? "Waiting for the worker to start reporting…" : "No domains match this filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(hrefFor({ dpage: page - 1 }))}
                  disabled={page <= 1}
                  className={`rounded-lg border border-border px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
                >
                  Previous
                </button>
                <button
                  onClick={() => router.push(hrefFor({ dpage: page + 1 }))}
                  disabled={page >= pageCount}
                  className={`rounded-lg border border-border px-3 py-1.5 ${page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

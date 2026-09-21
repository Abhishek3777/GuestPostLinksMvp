"use client";

import { useState } from "react";
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

export function DomainStatusSection({ domainStatuses, isLive }: { domainStatuses: DomainStatus[]; isLive: boolean }) {
  const [filter, setFilter] = useState<string | null>(null);

  const counts = new Map<string, number>();
  for (const d of domainStatuses) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
  const segments: Segment[] = [...counts.entries()].map(([status, value]) => ({
    key: status,
    label: status.replace(/_/g, " "),
    value,
    tone: STATUS_TONE[status] ?? "neutral",
  }));

  const rows = filter ? domainStatuses.filter((d) => d.status === filter) : domainStatuses;

  return (
    <>
      {domainStatuses.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-medium text-text">
            Domain outcome breakdown <span className="font-normal text-muted">— click a segment to see why</span>
          </h2>
          <ProportionBar segments={segments} onSegmentClick={(key) => setFilter((cur) => (cur === key ? null : key))} activeKey={filter} />
        </div>
      )}

      {domainStatuses.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Domain status (Stage 1) {filter && <span className="normal-case text-accent">— filtered: {filter.replace(/_/g, " ")}</span>}
          </h2>
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
        </section>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, Pause, Play, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { SiteActiveToggle } from "@/components/SiteActiveToggle";
import { DeleteSiteButton } from "@/components/DeleteSiteButton";

export interface SiteRow {
  id: string;
  domain: string;
  active: boolean;
  lastRunAt: Date | null;
  lastCampaignId: string | null;
  campaignStatus: string | null;
  contactStageStatus: string | null;
  crawlStatus: string | null;
  crawlReason: string | null;
  links: number | null;
  ownerEmail: string | null;
}

function formatWhen(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// The table plus row checkboxes and a bulk action bar for exactly the rows
// you've ticked — separate from SitesBulkActions, which acts on everything the
// current search/filter shows instead of a manual selection.
export function SitesTable({ sites, showOwner = false }: { sites: SiteRow[]; showOwner?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"on" | "off" | "delete" | null>(null);

  const allSelected = sites.length > 0 && sites.every((s) => selected.has(s.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sites.map((s) => s.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ids = useMemo(() => [...selected], [selected]);

  async function bulkActivate(active: boolean) {
    setBusy(active ? "on" : "off");
    await fetch("/api/sites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active, ids }),
    });
    setBusy(null);
    setSelected(new Set());
    router.refresh();
  }

  async function bulkDelete() {
    if (!confirm(`Remove ${ids.length} selected site${ids.length === 1 ? "" : "s"} from Sites to monitor?`)) return;
    setBusy("delete");
    await fetch("/api/sites", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setBusy(null);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm">
          <span className="font-medium text-accent">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => bulkActivate(true)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {busy === "on" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Activate
            </button>
            <button
              onClick={() => bulkActivate(false)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {busy === "off" ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />} Pause
            </button>
            <button
              onClick={bulkDelete}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
            >
              {busy === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-5 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-5 py-3">Active</th>
              <th className="px-5 py-3">Domain</th>
              {showOwner && <th className="px-5 py-3">Added by</th>}
              <th className="px-5 py-3">Last run</th>
              <th className="px-5 py-3">Last result</th>
              <th className="px-5 py-3">Backlinks</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const inProgress =
                s.campaignStatus === "queued" ||
                s.campaignStatus === "running" ||
                s.contactStageStatus === "queued" ||
                s.contactStageStatus === "running";
              return (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleOne(s.id)}
                      aria-label={`Select ${s.domain}`}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <SiteActiveToggle id={s.id} domain={s.domain} active={s.active} />
                  </td>
                  <td className={`px-5 py-3 font-medium ${s.active ? "text-text" : "text-muted"}`}>{s.domain}</td>
                  {showOwner && <td className="px-5 py-3 text-muted">{s.ownerEmail ?? "— (legacy)"}</td>}
                  <td className="px-5 py-3 text-muted">
                    {s.lastCampaignId ? (
                      <Link href={`/campaigns/${s.lastCampaignId}`} className="hover:text-accent hover:underline">
                        {formatWhen(s.lastRunAt)}
                      </Link>
                    ) : (
                      "Never run"
                    )}
                  </td>
                  <td className="px-5 py-3" title={s.crawlReason ?? undefined}>
                    {!s.lastCampaignId ? (
                      <span className="text-muted">—</span>
                    ) : inProgress ? (
                      <StatusBadge status={s.campaignStatus === "queued" ? "queued" : "running"} />
                    ) : s.crawlStatus ? (
                      <StatusBadge status={s.crawlStatus} />
                    ) : (
                      <span className="text-muted">not reached</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted">{s.links === null ? "—" : s.links.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <DeleteSiteButton id={s.id} domain={s.domain} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

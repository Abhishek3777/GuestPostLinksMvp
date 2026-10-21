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
  posts: number | null;
  ownerEmail: string | null;
  // Cumulative links/posts ever found for this domain, across every run —
  // unlike `links`/`posts` above (last run only), these don't reset. See the
  // matching comment on watchedSites.totalLinksFound (lib/schema.ts) for why
  // "all time" can't go back further than when this shipped.
  totalLinksFound: number;
  totalPostsFound: number;
}

function formatWhen(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export interface SitesMatchQuery {
  q?: string;
  filter?: string;
  ownerId?: string;
}

// The table plus row checkboxes and a bulk action bar for exactly the rows
// you've ticked — separate from SitesBulkActions, which acts on everything the
// current search/filter shows instead of a manual selection.
//
// Two distinct selection modes, both explicit so neither is ever ambiguous:
//   - "page": the usual checked-rows set, scoped to this page's `sites` only.
//   - "all-matching": every site that matches the current search/filter,
//     not just this page — needed once a list runs past one page (confirmed
//     live, 2026-10-19: "select all" previously only ever meant "select this
//     page's 50", with no way to act on a filtered owner's full list at
//     once). Carries no id list client-side (could be tens of thousands) —
//     the bulk action is sent with the filter itself, same shape the PATCH
//     endpoint already accepted for this (q/filter/ownerId), just never had
//     a UI path to it before.
// Delete deliberately stays "page" (explicit ids) only — bulk-deleting a
// filtered set of potentially thousands of monitored sites in one action is
// a materially more destructive operation than pause/activate, not something
// to fire off from a filter with no per-row confirmation.
export function SitesTable({
  sites,
  showOwner = false,
  total,
  matchQuery,
  members,
}: {
  sites: SiteRow[];
  showOwner?: boolean;
  total: number;
  matchQuery: SitesMatchQuery;
  // Admin only: every team member, for the "reassign to" picker. Undefined
  // for a non-admin viewer, which is what hides the control entirely.
  members?: { id: string; email: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [busy, setBusy] = useState<"on" | "off" | "delete" | "reassign" | null>(null);
  const [reassignTarget, setReassignTarget] = useState("");
  // Which number the Backlinks column shows — last run only, or the
  // cumulative all-time counter. Purely a display toggle: both numbers are
  // already fetched per row, nothing to refetch when this flips.
  const [backlinksMode, setBacklinksMode] = useState<"last" | "all">("last");

  const pageSelected = sites.length > 0 && sites.every((s) => selected.has(s.id));
  const moreBeyondThisPage = total > sites.length;

  function toggleAll() {
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelected(new Set());
      return;
    }
    setSelected(pageSelected ? new Set() : new Set(sites.map((s) => s.id)));
  }

  function toggleOne(id: string) {
    setSelectAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setSelectAllMatching(false);
  }

  const ids = useMemo(() => [...selected], [selected]);
  const selectedCount = selectAllMatching ? total : selected.size;

  async function bulkActivate(active: boolean) {
    setBusy(active ? "on" : "off");
    await fetch("/api/sites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selectAllMatching ? { active, ...matchQuery } : { active, ids }),
    });
    setBusy(null);
    clearSelection();
    router.refresh();
  }

  async function bulkReassign(newOwnerId: string) {
    const target = members?.find((m) => m.id === newOwnerId);
    if (!target) return;
    if (!confirm(`Reassign ${selectedCount.toLocaleString()} site${selectedCount === 1 ? "" : "s"} to ${target.email}?`)) {
      setReassignTarget("");
      return;
    }
    setBusy("reassign");
    await fetch("/api/sites/reassign", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selectAllMatching ? { newOwnerId, ...matchQuery } : { newOwnerId, ids }),
    });
    setBusy(null);
    setReassignTarget("");
    clearSelection();
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
    clearSelection();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {selectedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm">
          <span className="font-medium text-accent">
            {selectedCount.toLocaleString()} selected{selectAllMatching ? " (every site matching this view)" : ""}
          </span>
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
            {members && members.length > 0 && (
              <select
                value={reassignTarget}
                onChange={(e) => {
                  setReassignTarget(e.target.value);
                  if (e.target.value) bulkReassign(e.target.value);
                }}
                disabled={busy !== null}
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-text outline-none ring-accent/40 focus:ring-2 disabled:opacity-50"
              >
                <option value="">
                  {busy === "reassign" ? "Reassigning…" : "Reassign to"}
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email}
                  </option>
                ))}
              </select>
            )}
            {/* Delete stays page-only — see the comment above this component
                for why a filter-wide bulk delete is deliberately not offered. */}
            {!selectAllMatching && (
              <button
                onClick={bulkDelete}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
              >
                {busy === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
              </button>
            )}
            <button
              onClick={clearSelection}
              disabled={busy !== null}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {pageSelected && !selectAllMatching && moreBeyondThisPage && (
        <div className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">
          All {sites.length.toLocaleString()} sites on this page are selected.{" "}
          <button onClick={() => setSelectAllMatching(true)} className="font-medium text-accent hover:underline">
            Select all {total.toLocaleString()} sites matching this view
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-5 py-3">
                <input type="checkbox" checked={pageSelected || selectAllMatching} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-5 py-3">Active</th>
              <th className="px-5 py-3">Domain</th>
              {showOwner && <th className="px-5 py-3">Added by</th>}
              <th className="px-5 py-3">Last run</th>
              <th className="px-5 py-3">Last result</th>
              <th className="px-5 py-3">Guest posts</th>
              <th className="px-5 py-3">
                <div className="flex items-center gap-1.5">
                  <span>Backlinks</span>
                  <div className="flex rounded-md border border-border bg-bg p-0.5 text-[10px] normal-case tracking-normal">
                    <button
                      type="button"
                      onClick={() => setBacklinksMode("last")}
                      className={`rounded px-1.5 py-0.5 font-medium transition-colors ${backlinksMode === "last" ? "bg-accent-soft text-accent" : "text-muted hover:text-text"}`}
                    >
                      Last run
                    </button>
                    <button
                      type="button"
                      onClick={() => setBacklinksMode("all")}
                      className={`rounded px-1.5 py-0.5 font-medium transition-colors ${backlinksMode === "all" ? "bg-accent-soft text-accent" : "text-muted hover:text-text"}`}
                    >
                      All time
                    </button>
                  </div>
                  <span className="font-normal normal-case text-muted/70">(applies to both)</span>
                </div>
              </th>
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
                      checked={selectAllMatching || selected.has(s.id)}
                      disabled={selectAllMatching}
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
                  <td className="px-5 py-3 text-muted">
                    {backlinksMode === "all"
                      ? s.totalPostsFound.toLocaleString()
                      : s.posts === null
                        ? "—"
                        : s.posts.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-muted">
                    {backlinksMode === "all"
                      ? s.totalLinksFound.toLocaleString()
                      : s.links === null
                        ? "—"
                        : s.links.toLocaleString()}
                  </td>
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

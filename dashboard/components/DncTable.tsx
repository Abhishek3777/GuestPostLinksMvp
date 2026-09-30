"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { DeleteDncButton } from "@/components/DeleteDncButton";

export interface DncRow {
  id: string;
  domain: string;
  addedAt: Date;
}

// Two selection modes, same as a typical mail inbox: ticking rows (or the
// header checkbox) selects only what's on THIS page — that's all `selected`
// ever holds. Once every row on the page is ticked, a banner offers to select
// all `total` domains matching the current search instead; accepting that
// switches to `allMatching` mode, which bulk-deletes by the search filter
// server-side rather than shipping a six-figure id list to the browser.
export function DncTable({ entries, total, q }: { entries: DncRow[]; total: number; q: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [busy, setBusy] = useState(false);

  const allOnPageSelected = entries.length > 0 && entries.every((e) => selected.has(e.id));
  const selectedCount = allMatching ? total : selected.size;

  function toggleAll() {
    setAllMatching(false);
    setSelected(allOnPageSelected ? new Set() : new Set(entries.map((e) => e.id)));
  }

  function toggleOne(id: string) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  const ids = useMemo(() => [...selected], [selected]);

  async function bulkDelete() {
    const label = q ? `${selectedCount.toLocaleString()} domain(s) matching "${q}"` : `${selectedCount.toLocaleString()} domain(s)`;
    if (!confirm(`Remove ${label} from Do Not Contact? This can't be undone.`)) return;
    setBusy(true);
    await fetch("/api/do-not-contact", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(allMatching ? { allMatching: true, q } : { ids }),
    });
    setBusy(false);
    clearSelection();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {(selected.size > 0 || allMatching) && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-accent">{selectedCount.toLocaleString()} selected</span>
            <div className="flex items-center gap-3">
              <button onClick={clearSelection} className="text-xs font-medium text-muted hover:text-text">
                Clear
              </button>
              <button
                onClick={bulkDelete}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
              </button>
            </div>
          </div>
          {!allMatching && allOnPageSelected && total > entries.length && (
            <button onClick={() => setAllMatching(true)} className="text-left text-xs font-medium text-accent hover:underline">
              All {entries.length} on this page are selected. Select all {total.toLocaleString()}
              {q ? ` matching "${q}"` : ""} instead.
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-5 py-3">
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all on this page" />
              </th>
              <th className="px-5 py-3">Domain</th>
              <th className="px-5 py-3">Added</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-5 py-3">
                  <input
                    type="checkbox"
                    checked={allMatching || selected.has(e.id)}
                    onChange={() => toggleOne(e.id)}
                    aria-label={`Select ${e.domain}`}
                  />
                </td>
                <td className="px-5 py-3 font-medium text-text">{e.domain}</td>
                <td className="px-5 py-3 text-muted">
                  {new Date(e.addedAt).toLocaleDateString(undefined, { timeZone: "Asia/Kolkata" })}
                </td>
                <td className="px-5 py-3 text-right">
                  <DeleteDncButton id={e.id} domain={e.domain} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

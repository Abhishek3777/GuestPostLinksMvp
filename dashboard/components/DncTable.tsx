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

// Same checkbox-row-selection + bulk action bar pattern as SitesTable.
export function DncTable({ entries }: { entries: DncRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)));
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

  async function bulkDelete() {
    if (!confirm(`Remove ${ids.length} selected domain${ids.length === 1 ? "" : "s"} from Do Not Contact?`)) return;
    setBusy(true);
    await fetch("/api/do-not-contact", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm">
          <span className="font-medium text-accent">{selected.size} selected</span>
          <button
            onClick={bulkDelete}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-5 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
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
                    checked={selected.has(e.id)}
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

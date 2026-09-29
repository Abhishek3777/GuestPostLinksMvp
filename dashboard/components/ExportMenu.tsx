"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { DIRECT_COLUMNS, FULL_PIPELINE_COLUMNS, FULL_PIPELINE_DEFAULT_COLUMNS } from "@/lib/campaignCsv";

// One button per file type. Clicking it opens a column picker with a
// Download button. Direct/Contact-Lookup exports are compact enough already
// that everything starts ticked; full-pipeline exports start on just the
// lead-facing columns (see FULL_PIPELINE_DEFAULT_COLUMNS) — the rest of the
// crawl-process detail is one tick away, not hidden, just not the default.
export function ExportMenu({
  campaignId,
  mode,
  format,
  label,
}: {
  campaignId: string;
  mode: "discovery" | "direct";
  format: "xlsx" | "csv";
  label: string;
}) {
  const columns: readonly string[] = mode === "direct" ? DIRECT_COLUMNS : FULL_PIPELINE_COLUMNS;
  const defaultColumns: readonly string[] = mode === "direct" ? DIRECT_COLUMNS : FULL_PIPELINE_DEFAULT_COLUMNS;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultColumns));
  // Testing aid for the group-dedup feature — off by default, not meant to be
  // the normal export. See the export route's comment for what it actually shows.
  const [ignoreGroupDedup, setIgnoreGroupDedup] = useState(false);

  function toggle(column: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }

  const chosen = columns.filter((c) => selected.has(c));
  const parts = [
    format === "xlsx" ? "format=xlsx" : "",
    chosen.length === columns.length ? "" : `cols=${encodeURIComponent(chosen.join(","))}`,
    ignoreGroupDedup ? "ignoreGroupDedup=true" : "",
  ].filter(Boolean);
  const href = `/api/campaigns/${campaignId}/export${parts.length ? `?${parts.join("&")}` : ""}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
      >
        <Download size={14} /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label={label}
            className="max-h-[85vh] w-full max-w-md overflow-auto rounded-xl border border-border bg-surface p-5 text-left shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text">{label}</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-text" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-text">
                Columns ({chosen.length}/{columns.length})
              </span>
              <span className="flex gap-3 text-xs">
                <button type="button" onClick={() => setSelected(new Set(columns))} className="text-accent hover:underline">
                  Select all
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-accent hover:underline">
                  Clear
                </button>
              </span>
            </div>
            <div className="mb-5 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {columns.map((column) => (
                <label key={column} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={selected.has(column)} onChange={() => toggle(column)} />
                  {column}
                </label>
              ))}
            </div>

            <label className="mb-4 flex cursor-pointer items-start gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ignoreGroupDedup}
                onChange={(e) => setIgnoreGroupDedup(e.target.checked)}
              />
              <span>
                <span className="font-medium text-text">Ignore group dedup (testing)</span> — include leads excluded as
                &quot;claimed by teammate&quot;, so you can compare against the normal export. Their contact info stays blank
                (lookup was skipped for them).
              </span>
            </label>

            <a
              href={chosen.length ? href : undefined}
              aria-disabled={chosen.length === 0}
              onClick={() => chosen.length && setOpen(false)}
              className={`flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity ${
                chosen.length ? "hover:opacity-90" : "pointer-events-none opacity-50"
              }`}
            >
              <Download size={14} /> Download
            </a>
          </div>
        </div>
      )}
    </>
  );
}

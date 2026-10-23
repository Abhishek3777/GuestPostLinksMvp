"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Rocket, Search } from "lucide-react";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
] as const;

// Search box + All/Active/Paused tabs. State lives in the URL so a filtered
// view can be refreshed, shared and paged.
export function SitesFilters({ counts }: { counts: { all: number; active: number; paused: number } }) {
  const router = useRouter();
  const params = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function hrefFor(next: { q?: string; filter?: string }) {
    const p = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    p.delete("page");
    const qs = p.toString();
    return qs ? `/sites?${qs}` : "/sites";
  }

  function onSearch(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.replace(hrefFor({ q: value.trim() })), 300);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-lg border border-border bg-surface p-0.5 text-sm">
        {FILTERS.map(({ value, label }) => (
          <Link
            key={value}
            href={hrefFor({ filter: value === "all" ? "" : value })}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${filter === value ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
              }`}
          >
            {label} · {counts[value].toLocaleString()}
          </Link>
        ))}
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search domains"
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 sm:w-64 pr-3 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
        />
      </div>
    </div>
  );
}

// Admin-only: "who holds which and how much" — filter the list down to one
// member's sites, or the legacy unassigned bucket. State lives in the URL,
// same pattern as SitesFilters.
export function SitesOwnerFilter({
  owners,
  unassignedCount,
  selected,
}: {
  owners: { id: string; email: string; count: number }[];
  unassignedCount: number;
  selected?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(value: string) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set("owner", value);
    else p.delete("owner");
    p.delete("page");
    const qs = p.toString();
    router.push(qs ? `/sites?${qs}` : "/sites");
  }

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none ring-accent/40 focus:ring-2"
    >
      <option value="">Everyone&apos;s sites</option>
      {owners.map((o) => (
        <option key={o.id} value={o.id}>
          {o.email} ({o.count.toLocaleString()})
        </option>
      ))}
      {unassignedCount > 0 && <option value="unassigned">Added before ownership existed ({unassignedCount.toLocaleString()})</option>}
    </select>
  );
}

// Same format the backend falls back to when no name is given, shown as a
// placeholder so the field is never blank-feeling even before you type.
function defaultRunName() {
  return `Monitor run — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
}

export function RunSitesButton({
  activeCount,
  endpoint = "/api/sites/run",
  label = "Run active sites",
}: {
  activeCount: number;
  // Lets Analytics's "Run priority sites" button reuse this exact component
  // (naming form, post-count/day-window overrides, same campaign flow)
  // instead of a parallel copy — only the endpoint and label differ.
  endpoint?: string;
  label?: string;
}) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // Blank = use the automatic "only new since last run" window, same as
  // before this existed. Set either to override it for this run only.
  const [targetPostCount, setTargetPostCount] = useState("");
  const [daysWindow, setDaysWindow] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        targetPostCount: targetPostCount || undefined,
        daysWindow: daysWindow || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.campaignId) {
      router.push(`/campaigns/${data.campaignId}`);
      return;
    }
    setBusy(false);
    setNaming(false);
    setError(data.error ?? "Could not start the run");
    router.refresh();
  }

  if (naming) {
    return (
      <div className="flex w-full max-w-72 flex-col gap-1.5 rounded-lg border border-border bg-surface p-3">
        <label className="text-xs font-medium text-muted">Campaign name (optional)</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          placeholder={defaultRunName()}
          className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text outline-none ring-accent/40 placeholder:text-muted/70 focus:ring-2"
        />

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted">Posts per domain</label>
            <select
              value={targetPostCount}
              onChange={(e) => setTargetPostCount(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none ring-accent/40 focus:ring-2"
            >
              <option value="">Auto</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={1000}>No limit</option>
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted">Only last N days</label>
            <input
              type="number"
              min={1}
              value={daysWindow}
              onChange={(e) => setDaysWindow(e.target.value)}
              placeholder="Auto"
              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none ring-accent/40 placeholder:text-muted/70 focus:ring-2"
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Leave both on Auto to only read what&apos;s new since each site&apos;s last run the usual monitoring behavior.
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => setNaming(false)}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={start}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
            {busy ? "Starting…" : `Run ${activeCount.toLocaleString()} site${activeCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => setNaming(true)}
        disabled={activeCount === 0}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Rocket size={15} />
        {label} ({activeCount.toLocaleString()})
      </button>
      {error && <span className="max-w-xs text-right text-xs text-danger">{error}</span>}
    </div>
  );
}

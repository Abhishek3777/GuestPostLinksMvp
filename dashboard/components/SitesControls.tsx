"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Rocket, Search } from "lucide-react";

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
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              filter === value ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
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
          className="w-64 rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
        />
      </div>
    </div>
  );
}

// Activate / pause everything the list is currently showing (its search + filter,
// across all pages — not just the rows on screen).
export function SitesBulkActions({ visibleCount }: { visibleCount: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<"on" | "off" | null>(null);

  async function bulk(active: boolean) {
    const q = params.get("q") ?? "";
    const filter = params.get("filter") ?? "all";
    const scope =
      q || filter !== "all"
        ? `the ${visibleCount.toLocaleString()} sites matching this view`
        : `all ${visibleCount.toLocaleString()} sites`;
    if (!confirm(`${active ? "Activate" : "Pause"} ${scope}?`)) return;
    setBusy(active ? "on" : "off");
    await fetch("/api/sites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active, q, filter }),
    });
    setBusy(null);
    router.refresh();
  }

  const btn =
    "flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50";
  return (
    <div className="flex gap-2">
      <button className={btn} disabled={busy !== null || visibleCount === 0} onClick={() => bulk(true)}>
        {busy === "on" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Activate shown
      </button>
      <button className={btn} disabled={busy !== null || visibleCount === 0} onClick={() => bulk(false)}>
        {busy === "off" ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />} Pause shown
      </button>
    </div>
  );
}

export function RunSitesButton({ activeCount }: { activeCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        `Run ${activeCount.toLocaleString()} active site${activeCount === 1 ? "" : "s"} now? New posts since the last run are crawled and their contacts looked up.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sites/run", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.campaignId) {
      router.push(`/campaigns/${data.campaignId}`);
      return;
    }
    setBusy(false);
    setError(data.error ?? "Could not start the run");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy || activeCount === 0}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
        {busy ? "Starting…" : `Run active sites (${activeCount.toLocaleString()})`}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-danger">{error}</span>}
    </div>
  );
}

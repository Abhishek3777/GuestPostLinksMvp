"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const TABS = [
  { value: "leaderboard", label: "Leaderboard" },
  { value: "priority", label: "Priority sites" },
] as const;

export function AnalyticsTabs({
  selected,
  counts,
}: {
  selected: "leaderboard" | "priority";
  counts: { leaderboard: number; priority: number };
}) {
  const params = useSearchParams();
  const q = params.get("q");

  function hrefFor(value: "leaderboard" | "priority") {
    const p = new URLSearchParams();
    if (value === "priority") p.set("tab", "priority");
    if (q) p.set("q", q);
    const qs = p.toString();
    return qs ? `/analytics?${qs}` : "/analytics";
  }

  return (
    <div className="flex rounded-lg border border-border bg-surface p-0.5 text-sm w-fit">
      {TABS.map(({ value, label }) => (
        <Link
          key={value}
          href={hrefFor(value)}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            selected === value ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
          }`}
        >
          {label} · {counts[value].toLocaleString()}
        </Link>
      ))}
    </div>
  );
}

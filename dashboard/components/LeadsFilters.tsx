"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { MemberOption, RangeKey } from "@/services/leads.service";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "custom", label: "Custom" },
];

interface Props {
  range: RangeKey;
  from: string;
  to: string;
  userId: string | null;
  members: MemberOption[];
  today: string;
}

export function LeadsFilters({ range, from, to, userId, members, today }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(next: { range?: RangeKey; from?: string; to?: string; user?: string | null }) {
    const r = next.range ?? range;
    const u = next.user === undefined ? userId : next.user;
    const p = new URLSearchParams();
    if (r !== "30d") p.set("range", r);
    if (r === "custom") {
      p.set("from", next.from ?? from);
      p.set("to", next.to ?? to);
    }
    if (u) p.set("user", u);
    const qs = p.toString();
    startTransition(() => router.push(qs ? `/leads?${qs}` : "/leads"));
  }

  const dateInput =
    "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent";

  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => go({ range: r.value })}
            className={`px-3 py-1.5 text-sm transition-colors ${
              range === r.value ? "bg-accent text-white" : "bg-surface text-muted hover:text-text"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && go({ from: e.target.value })}
            className={dateInput}
            aria-label="From date"
          />
          <span>to</span>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => e.target.value && go({ to: e.target.value })}
            className={dateInput}
            aria-label="To date"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-muted">
        Member
        <select
          value={userId ?? ""}
          onChange={(e) => go({ user: e.target.value || null })}
          className={`${dateInput} min-w-40 text-text`}
        >
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

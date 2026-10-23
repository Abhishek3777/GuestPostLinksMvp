"use client";

import { useRouter } from "next/navigation";

export function SettingsTabSwitcher({ selected }: { selected: "team" | "costs" }) {
  const router = useRouter();

  return (
    <select
      value={selected}
      onChange={(e) => router.push(e.target.value === "costs" ? "/settings?tab=costs" : "/settings")}
      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none ring-accent/40 focus:ring-2"
    >
      <option value="team">Team</option>
      <option value="costs">Costs</option>
    </select>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

// Same debounced-search-in-the-URL pattern as SitesFilters, minus the
// active/paused tabs — Do Not Contact has no such dimension.
export function DncSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function onSearch(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      if (value.trim()) p.set("q", value.trim());
      else p.delete("q");
      p.delete("page");
      const qs = p.toString();
      router.replace(qs ? `/do-not-contact?${qs}` : "/do-not-contact");
    }, 300);
  }

  return (
    <div className="relative w-64">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search domains"
        className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
      />
    </div>
  );
}

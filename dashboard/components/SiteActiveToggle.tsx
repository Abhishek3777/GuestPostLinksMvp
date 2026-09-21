"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SiteActiveToggle({ id, domain, active }: { id: string; domain: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Optimistic: flip immediately, the refresh confirms it.
  const [value, setValue] = useState(active);

  async function toggle() {
    const next = !value;
    setValue(next);
    setBusy(true);
    const res = await fetch(`/api/sites/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    setBusy(false);
    if (!res.ok) setValue(!next);
    router.refresh();
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={`${value ? "Pause" : "Activate"} ${domain}`}
      title={value ? "Active — included in runs. Click to pause." : "Paused — skipped by runs. Click to activate."}
      onClick={toggle}
      disabled={busy}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${value ? "bg-accent" : "bg-border"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${value ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

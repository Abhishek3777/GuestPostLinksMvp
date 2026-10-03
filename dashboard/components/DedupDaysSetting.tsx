"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users2 } from "lucide-react";

export function DedupDaysSetting({ dedupDays }: { dedupDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function update(value: string) {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0) return;
    setBusy(true);
    await fetch("/api/settings/dedup", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dedupDays: days }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users2 size={16} className="text-muted" />
        <h2 className="text-sm font-semibold text-text">Lead re-contact cooldown</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        Nobody on the team works the same lead twice — whoever finds it first keeps it, and everyone else sees it
        excluded as &quot;claimed by teammate&quot; for this many days. A lead is considered spoken for the moment
        it&apos;s kept, whether or not contact info was actually found yet — since that&apos;s exactly what would show
        up in an export. Applies across every campaign, regardless of who started it.
      </p>
      <label className="flex w-fit items-center gap-1.5 text-xs text-muted">
        Re-contact after
        <input
          type="number"
          min={0}
          defaultValue={dedupDays}
          disabled={busy}
          onBlur={(e) => update(e.target.value)}
          className="w-20 rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
        days
      </label>
    </div>
  );
}

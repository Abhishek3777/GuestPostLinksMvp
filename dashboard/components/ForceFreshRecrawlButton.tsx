"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export function ForceFreshRecrawlButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function click() {
    if (
      !confirm(
        "Restart this campaign as a complete fresh crawl? " +
          "Every domain gets re-checked from scratch, ignoring any earlier run's history — use this if it was started with the wrong settings."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/force-fresh-recrawl`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Could not start the fresh recrawl");
    } catch {
      setError("Could not reach the server");
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={click}
        disabled={busy}
        title="Re-crawl every domain from scratch, ignoring earlier run history"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {busy ? "Starting…" : "Force fresh recrawl"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

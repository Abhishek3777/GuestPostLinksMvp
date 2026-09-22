"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

export function RetryFailedButton({ campaignId, count }: { campaignId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function click() {
    if (
      !confirm(
        `Retry ${count} blocked or failed lead${count === 1 ? "" : "s"}? Leads already reached are left alone. ` +
          "Blocks often come and go, so a retry a few hours later can recover some."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/retry-failed`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Could not start the retry");
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
        title="Look up the blocked and failed leads again"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
        {busy ? "Starting…" : `Retry blocked & failed (${count})`}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, SearchCheck } from "lucide-react";

export function RetryNoPostsFoundButton({ campaignId, count }: { campaignId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function click() {
    if (
      !confirm(
        `Re-check ${count} "no posts found" domain${count === 1 ? "" : "s"}? ` +
          "Every other domain is left alone. This re-crawls just these with the current discovery logic."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/retry-no-posts-found`, { method: "POST" });
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
        title="Re-crawl the 'no posts found' domains again"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />}
        {busy ? "Starting…" : `Retry no posts found (${count})`}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

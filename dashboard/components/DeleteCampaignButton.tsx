"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

export function DeleteCampaignButton({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function click() {
    if (!confirm(`Delete "${campaignName}"? This removes all its domains, links and prospects — it cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Could not delete the campaign");
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={click}
        disabled={busy}
        title="Delete this campaign so it can be restarted fresh"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

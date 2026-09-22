"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";

export function PauseResumeButton({
  campaignId,
  action,
  compact = false,
}: {
  campaignId: string;
  action: "pause" | "resume";
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pausing = action === "pause";

  async function click() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
      if (!res.ok) setError("Could not update the campaign");
    } catch {
      setError("Could not reach the server");
    }
    setBusy(false);
    router.refresh();
  }

  const Icon = busy ? Loader2 : pausing ? Pause : Play;
  const label = pausing ? "Pause" : "Resume";
  const title = pausing
    ? "Pause: sites already being worked on finish, nothing new starts, and the worker moves on to the next campaign"
    : "Resume: continues from where it stopped";

  if (compact) {
    return (
      <button
        onClick={click}
        disabled={busy}
        title={error ?? title}
        aria-label={`${label} campaign`}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
      >
        <Icon size={13} className={busy ? "animate-spin" : ""} />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={click}
        disabled={busy}
        title={title}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        <Icon size={14} className={busy ? "animate-spin" : ""} />
        {busy ? (pausing ? "Pausing…" : "Resuming…") : label}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

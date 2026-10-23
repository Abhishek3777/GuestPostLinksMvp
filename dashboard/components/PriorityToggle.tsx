"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pin, PinOff } from "lucide-react";

export function PriorityToggle({ id, isPriority }: { id: string; isPriority: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch("/api/sites/priority", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, isPriority: !isPriority }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={isPriority ? "Remove from priority sites" : "Mark as a priority site"}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
        isPriority ? "text-accent hover:bg-accent-soft" : "text-muted hover:bg-surface-2 hover:text-text"
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : isPriority ? <Pin size={14} fill="currentColor" /> : <PinOff size={14} />}
    </button>
  );
}

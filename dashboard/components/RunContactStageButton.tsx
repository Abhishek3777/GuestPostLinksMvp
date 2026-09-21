"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";

export function RunContactStageButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    await fetch(`/api/campaigns/${campaignId}/run-contact-stage`, { method: "POST" });
    router.refresh();
  }

  return (
    <button
      onClick={start}
      disabled={starting}
      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {starting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
      {starting ? "Starting…" : "Run Contact Scrape"}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Polls the server component's data by refreshing the route every few
// seconds. Only mounted while a campaign is queued/running — the worker
// writes to Supabase as it goes, so a refresh is enough to show live
// progress without any direct connection to the worker process itself.
export function AutoRefresh({ intervalMs = 12000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}

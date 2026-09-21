"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";

export function DeleteSiteButton({ id, domain }: { id: string; domain: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Remove ${domain} from Sites to monitor? Results from past runs are kept.`)) return;
    setDeleting(true);
    await fetch(`/api/sites/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-muted transition-colors hover:text-danger disabled:opacity-50"
      title={`Remove ${domain}`}
    >
      {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  );
}

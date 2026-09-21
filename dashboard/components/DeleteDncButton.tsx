"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";

export function DeleteDncButton({ id, domain }: { id: string; domain: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Remove ${domain} from the Do Not Contact list?`)) return;
    setDeleting(true);
    await fetch(`/api/do-not-contact/${id}`, { method: "DELETE" });
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

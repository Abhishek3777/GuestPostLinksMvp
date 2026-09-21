"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";

export function DncUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setSubmitting(true);
    setMessage(null);

    const formData = new FormData();
    formData.set("domainsFile", file);
    const res = await fetch("/api/do-not-contact", { method: "POST", body: formData });
    const data = await res.json();

    setSubmitting(false);
    if (!res.ok) {
      setMessage(data.error ?? "Something went wrong");
      return;
    }
    setMessage(`Added ${data.added} domain(s)`);
    router.refresh();
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
      >
        {submitting ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
        {submitting ? "Uploading…" : "Upload CSV"}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {message && <p className="text-xs text-muted">{message}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Plus, UploadCloud } from "lucide-react";

export function SitesAddForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setBusy(true);
    setMessage(null);

    const formData = new FormData();
    if (text.trim()) formData.set("domainsText", text);
    if (file) formData.set("domainsFile", file);
    const res = await fetch("/api/sites", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setMessage({ tone: "error", text: data.error ?? "Something went wrong" });
      return;
    }
    const parts = [`Added ${data.added}`];
    if (data.skipped) parts.push(`${data.skipped} already in the list`);
    if (data.invalid) parts.push(`${data.invalid} not valid domains`);
    setMessage({ tone: "ok", text: parts.join(" · ") });
    setText("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-medium text-text">Add sites</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={"example.com\nanother-site.org\n(one per line — full URLs and www. are cleaned up)"}
        className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || (!text.trim() && !file)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {busy ? "Adding…" : "Add to list"}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
        >
          <UploadCloud size={14} />
          {file ? file.name : "Upload .csv / .txt"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {message && (
          <span className={`text-xs ${message.tone === "error" ? "text-danger" : "text-muted"}`}>{message.text}</span>
        )}
      </div>
    </form>
  );
}

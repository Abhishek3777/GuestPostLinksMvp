"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UploadCloud, FileText, X, Loader2, Search, Mail, Radar } from "lucide-react";

type Mode = "discovery" | "direct";

function NewCampaignForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "direct" ? "direct" : "discovery");
  const [file, setFile] = useState<File | null>(null);
  const [inputMethod, setInputMethod] = useState<"paste" | "upload">("paste");
  const [domainsText, setDomainsText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolved server-side at submit time (see api/campaigns/route.ts), not by
  // merging into the text box — that way it works whether you pasted domains
  // or uploaded a file, and there's no size limit from stuffing a textarea.
  const [includeMonitoredSites, setIncludeMonitoredSites] = useState(false);
  const [monitorSiteCount, setMonitorSiteCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data) => setMonitorSiteCount(Array.isArray(data.domains) ? data.domains.length : 0))
      .catch(() => setMonitorSiteCount(0));
  }, []);

  function pickFile(f: File | undefined | null) {
    if (f) setFile(f);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const canFallBackToMonitorList = mode === "discovery" && includeMonitoredSites;
    if (inputMethod === "upload" && !file && !canFallBackToMonitorList) {
      setError(mode === "discovery" ? "Upload a domains file first" : "Upload a target-domains file first");
      return;
    }
    if (inputMethod === "paste" && !domainsText.trim() && !canFallBackToMonitorList) {
      setError("Enter at least one domain");
      return;
    }

    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    if (inputMethod === "upload" && file) formData.set("domainsFile", file);
    else formData.set("domainsText", domainsText);
    formData.set("mode", mode);
    if (mode === "discovery") formData.set("includeMonitoredSites", includeMonitoredSites ? "true" : "false");

    // Whatever goes wrong (server error, dropped connection, a reply that is not
    // JSON) must end with a visible message and a usable button — never a
    // button stuck on "Starting…".
    try {
      const res = await fetch("/api/campaigns", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.campaignId) {
        setError(data.error ?? "Something went wrong. Nothing was started — please try again.");
        setSubmitting(false);
        return;
      }

      router.push(`/campaigns/${data.campaignId}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">New Campaign</h1>
        <p className="mt-1 text-sm text-muted">Choose how you want to start.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModeCard
          active={mode === "discovery"}
          onClick={() => setMode("discovery")}
          icon={Search}
          title="Discover & Filter"
          description="Upload guest-post sites to crawl. We find backlinks, dedupe, and filter them into prospects."
        />
        <ModeCard
          active={mode === "direct"}
          onClick={() => setMode("direct")}
          icon={Mail}
          title="Direct Contact Scrape"
          description="Already know the target domains? Skip straight to finding their email or contact form."
        />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium text-text">
            Campaign name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="e.g. September domains batch"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text">
              {mode === "discovery" ? "Guest-post sites" : "Target domains"}
            </label>
            <div className="flex rounded-lg border border-border bg-bg p-0.5 text-xs">
              {(["paste", "upload"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setInputMethod(m)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${inputMethod === m ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
                    }`}
                >
                  {m === "paste" ? "Type / paste" : "Upload file"}
                </button>
              ))}
            </div>
          </div>

          {inputMethod === "paste" ? (
            <>
              <textarea
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                rows={8}
                placeholder={"example.com\nanother-site.org\nhttps://www.third-site.net/blog"}
                spellCheck={false}
                className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
              />
              <p className="text-xs text-muted">
                One domain per line (commas or spaces work too). Full URLs and &quot;www.&quot; are cleaned up automatically.
              </p>
            </>
          ) : !file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? "border-accent bg-accent-soft" : "border-border hover:border-accent/50"
                }`}
            >
              <UploadCloud size={24} className="text-muted" />
              <p className="text-sm text-text">
                <span className="font-medium text-accent">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-muted">.csv, .txt or .xlsx — one domain per row (first column)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.xlsx"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-4 py-3">
              <div className="flex items-center gap-2.5">
                <FileText size={16} className="text-accent" />
                <span className="text-sm text-text">{file.name}</span>
                <span className="text-xs text-muted">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-muted hover:text-danger"
                aria-label="Remove file"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {inputMethod === "upload" && (
            <p className="text-xs text-muted">A header row named &quot;domain&quot; is fine too — it&apos;ll be skipped automatically.</p>
          )}
        </div>

        {mode === "discovery" && monitorSiteCount !== null && monitorSiteCount > 0 && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg px-4 py-3">
            <input
              type="checkbox"
              checked={includeMonitoredSites}
              onChange={(e) => setIncludeMonitoredSites(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                <Radar size={14} className="text-muted" />
                Also include my Sites to monitor list ({monitorSiteCount.toLocaleString()} active)
              </span>
              <span className="text-xs text-muted">
                Adds your active monitored sites to whatever you&apos;ve typed, pasted or uploaded above duplicates are
                dropped automatically, so it&apos;s safe to tick even if some overlap.
              </span>
            </span>
          </label>
        )}

        {mode === "discovery" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="targetPostCount" className="text-sm font-medium text-text">
                Posts per domain
              </label>
              <select
                id="targetPostCount"
                name="targetPostCount"
                defaultValue={5}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none ring-accent/40 focus:ring-2"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                {/* Same sentinel used for monitoring runs (see MONITOR_TARGET_POSTS) — high
                    enough that only a domain's actual post count limits how many are read. */}
                <option value={1000}>No limit</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="daysWindow" className="text-sm font-medium text-text">
                Only last N days
              </label>
              <input
                id="daysWindow"
                name="daysWindow"
                type="number"
                min={1}
                placeholder="Optional"
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
              />
            </div>
          </div>
        )}

        {mode === "discovery" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg px-4 py-3">
            <input type="checkbox" name="autoContact" defaultChecked className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-text">Also find emails &amp; contact forms automatically</span>
              <span className="text-xs text-muted">
                Runs contact lookup on every kept backlink target right after filtering, so one run goes from your domains
                all the way to contacts. Untick to review the kept list first and start it yourself.
              </span>
            </span>
          </label>
        )}

        {mode === "direct" && (
          <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
            No crawling — each domain still passes through the Do Not Contact / exclusion check, then goes straight
            to finding an email or contact form.
          </p>
        )}

        {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting && <Loader2 size={15} className="animate-spin" />}
          {submitting ? "Starting…" : "Start Campaign"}
        </button>
      </form>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense>
      <NewCampaignForm />
    </Suspense>
  );
}

function ModeCard({
  active,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/50"
        }`}
    >
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-accent text-white" : "bg-surface-2 text-muted"}`}>
        <Icon size={16} />
      </div>
      <div className={`text-sm font-medium ${active ? "text-accent" : "text-text"}`}>{title}</div>
      <p className="text-xs text-muted">{description}</p>
    </button>
  );
}

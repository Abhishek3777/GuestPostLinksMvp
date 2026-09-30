import { AlertTriangle, CheckCircle2, FileText, Hourglass, Mail, SearchX, ShieldAlert } from "lucide-react";
import { StatCard } from "./StatCard";
import { StatusBadge } from "./StatusBadge";
import { ProportionBar, type Segment } from "./ProportionBar";
import type { ContactFilterKey } from "@/services/campaigns.service";

// Plain-English names for why a site refused us (the worker records the raw code).
const BLOCK_LABEL: Record<string, string> = {
  cloudflare_js_challenge: "Cloudflare challenge",
  cloudflare_waf_block: "Cloudflare firewall",
  siteground_captcha: "SiteGround captcha",
  captcha_or_bot_check: "Bot check / captcha",
  http_403_forbidden: "403 Forbidden",
  http_401_unauthorized: "401 Unauthorized",
  http_429_rate_limited: "Rate limited (429)",
  http_503_unavailable: "503 Unavailable",
  http_406_not_acceptable: "406 Not acceptable",
  ddos_guard: "DDoS-Guard",
  sucuri_waf: "Sucuri firewall",
  js_reload_challenge: "JS challenge",
  js_required: "JavaScript required",
};

function blockReason(reason: string | null): string {
  const code = /(?:homepage|contact page)[^:]*:\s*([a-z0-9_]+)/i.exec(reason ?? "")?.[1]?.toLowerCase();
  if (!code) return "Other";
  return BLOCK_LABEL[code] ?? code.replace(/_/g, " ");
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

// Everything here is computed server-side in SQL (see campaigns.service.ts) —
// this component only ever receives small, precomputed numbers, never the
// full prospect list. That's the fix for the egress spike: these stats used
// to be derived by scanning every prospect row in JS on every page load.
export function ContactDashboard({
  stats,
  filterCounts,
  blockedReasons,
  stageStatus,
}: {
  stats: { kept: number; looked: number; reached: number; formsConfirmed: number; totalEmails: number; hasEmailStatus: number };
  filterCounts: Record<ContactFilterKey, number>;
  blockedReasons: (string | null)[];
  stageStatus: string;
}) {
  if (stats.kept === 0) return null;

  const waiting = stats.kept - stats.looked;
  const withEmail = filterCounts.has_email;
  const withForm = filterCounts.has_form;
  const both = filterCounts.both;
  const blocked = filterCounts.blocked;
  const nothing = filterCounts.none;
  const failed = filterCounts.failed;
  const formOnly = filterCounts.form_only;

  const blockReasons = new Map<string, number>();
  for (const reason of blockedReasons) blockReasons.set(blockReason(reason), (blockReasons.get(blockReason(reason)) ?? 0) + 1);
  const topBlocks = [...blockReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const segments: Segment[] = [
    { key: "has_email", label: "has email", value: stats.hasEmailStatus, tone: "success" },
    { key: "form_only", label: "form only", value: formOnly, tone: "info" },
    { key: "no_contact_found", label: "nothing found", value: nothing, tone: "neutral" },
    { key: "blocked", label: "blocked", value: blocked, tone: "warning" },
    { key: "failed", label: "failed", value: failed, tone: "danger" },
    { key: "pending", label: "not looked up yet", value: waiting, tone: "neutral" },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Contact results</h2>
        <StatusBadge status={stageStatus} />
        <span className="text-xs text-muted">
          {stats.looked} of {stats.kept} leads looked up
          {waiting > 0 ? ` · ${waiting} to go` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={`Reached · ${pct(stats.reached, stats.looked)} of looked up`}
          value={stats.reached}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard label={`With an email · ${pct(withEmail, stats.looked)}`} value={withEmail} icon={Mail} tone="success" />
        <StatCard label={`With a contact form · ${pct(withForm, stats.looked)}`} value={withForm} icon={FileText} tone="info" />
        <StatCard label={`Blocked · ${pct(blocked, stats.looked)}`} value={blocked} icon={ShieldAlert} tone={blocked ? "warning" : "neutral"} />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Email + form (both)" value={both} icon={CheckCircle2} tone="neutral" />
        <StatCard label="Nothing found" value={nothing} icon={SearchX} tone="neutral" />
        <StatCard label="Failed (timeout / DNS / error)" value={failed} icon={AlertTriangle} tone={failed ? "danger" : "neutral"} />
        <StatCard label="Not looked up yet" value={waiting} icon={Hourglass} tone="neutral" />
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <ProportionBar segments={segments} />
        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-border pt-4 text-xs text-muted sm:grid-cols-2">
          <div>
            <span className="font-medium text-text">{stats.totalEmails}</span> email address{stats.totalEmails === 1 ? "" : "es"} collected
            across <span className="font-medium text-text">{withEmail}</span> lead{withEmail === 1 ? "" : "s"}
            {withEmail > 0 ? ` (about ${(stats.totalEmails / withEmail).toFixed(1)} each)` : ""}
          </div>
          <div>
            <span className="font-medium text-text">{stats.formsConfirmed}</span> of{" "}
            <span className="font-medium text-text">{withForm}</span> contact form links confirmed as a real form
            {withForm - stats.formsConfirmed > 0 ? ` · ${withForm - stats.formsConfirmed} are contact pages to check by hand` : ""}
          </div>
          {topBlocks.length > 0 && (
            <div className="sm:col-span-2">
              <span className="mr-2 font-medium text-text">Why sites blocked us:</span>
              {topBlocks.map(([label, n]) => (
                <span key={label} className="mr-2 inline-block rounded-full bg-warning-soft px-2.5 py-0.5 text-warning">
                  {label} · {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

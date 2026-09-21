import { AlertTriangle, CheckCircle2, FileText, Hourglass, Mail, SearchX, ShieldAlert } from "lucide-react";
import { StatCard } from "./StatCard";
import { StatusBadge } from "./StatusBadge";
import { ProportionBar, type Segment } from "./ProportionBar";

interface DashboardProspect {
  exclusionReason: string | null;
  contactStatus: string;
  contactReason: string | null;
  emailAddress: string | null;
  contactFormUrl: string | null;
  contactCheckedAt: Date | string | null;
}

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
const emailCount = (p: DashboardProspect) => (p.emailAddress ? p.emailAddress.split(",").filter((e) => e.trim()).length : 0);

export function ContactDashboard({
  prospects,
  stageStatus,
}: {
  prospects: DashboardProspect[];
  stageStatus: string;
}) {
  // Only kept prospects get a contact lookup; excluded ones are not part of these numbers.
  const kept = prospects.filter((p) => !p.exclusionReason);
  if (kept.length === 0) return null;

  const looked = kept.filter((p) => p.contactCheckedAt);
  const waiting = kept.length - looked.length;

  const withEmail = looked.filter((p) => p.emailAddress).length;
  const withForm = looked.filter((p) => p.contactFormUrl).length;
  const both = looked.filter((p) => p.emailAddress && p.contactFormUrl).length;
  const reached = looked.filter((p) => p.emailAddress || p.contactFormUrl).length;
  const blocked = looked.filter((p) => p.contactStatus === "blocked");
  const nothing = looked.filter((p) => p.contactStatus === "no_contact_found").length;
  const failed = looked.filter((p) => ["timeout", "dns_error", "error"].includes(p.contactStatus)).length;
  const formOnly = looked.filter((p) => p.contactStatus === "form_only").length;

  // Form quality: a form is "confirmed" when the worker saw a real form on the page;
  // otherwise it is only a contact page that might hold one.
  const formsConfirmed = looked.filter((p) => p.contactFormUrl && /contact form confirmed/i.test(p.contactReason ?? "")).length;
  const totalEmails = looked.reduce((sum, p) => sum + emailCount(p), 0);

  const blockReasons = new Map<string, number>();
  for (const p of blocked) blockReasons.set(blockReason(p.contactReason), (blockReasons.get(blockReason(p.contactReason)) ?? 0) + 1);
  const topBlocks = [...blockReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const segments: Segment[] = [
    { key: "has_email", label: "has email", value: looked.filter((p) => p.contactStatus === "has_email").length, tone: "success" },
    { key: "form_only", label: "form only", value: formOnly, tone: "info" },
    { key: "no_contact_found", label: "nothing found", value: nothing, tone: "neutral" },
    { key: "blocked", label: "blocked", value: blocked.length, tone: "warning" },
    { key: "failed", label: "failed", value: failed, tone: "danger" },
    { key: "pending", label: "not looked up yet", value: waiting, tone: "neutral" },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Contact results</h2>
        <StatusBadge status={stageStatus} />
        <span className="text-xs text-muted">
          {looked.length} of {kept.length} leads looked up
          {waiting > 0 ? ` · ${waiting} to go` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={`Reached · ${pct(reached, looked.length)} of looked up`} value={reached} icon={CheckCircle2} tone="success" />
        <StatCard label={`With an email · ${pct(withEmail, looked.length)}`} value={withEmail} icon={Mail} tone="success" />
        <StatCard label={`With a contact form · ${pct(withForm, looked.length)}`} value={withForm} icon={FileText} tone="info" />
        <StatCard label={`Blocked · ${pct(blocked.length, looked.length)}`} value={blocked.length} icon={ShieldAlert} tone={blocked.length ? "warning" : "neutral"} />
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
            <span className="font-medium text-text">{totalEmails}</span> email address{totalEmails === 1 ? "" : "es"} collected across{" "}
            <span className="font-medium text-text">{withEmail}</span> lead{withEmail === 1 ? "" : "s"}
            {withEmail > 0 ? ` (about ${(totalEmails / withEmail).toFixed(1)} each)` : ""}
          </div>
          <div>
            <span className="font-medium text-text">{formsConfirmed}</span> of{" "}
            <span className="font-medium text-text">{withForm}</span> contact form links confirmed as a real form
            {withForm - formsConfirmed > 0 ? ` · ${withForm - formsConfirmed} are contact pages to check by hand` : ""}
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

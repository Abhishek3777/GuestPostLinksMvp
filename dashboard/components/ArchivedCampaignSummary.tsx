import { Archive } from "lucide-react";
import { ProportionBar, type Segment } from "./ProportionBar";
import type { ArchivedSummary } from "@/lib/schema";

const STATUS_LABEL: Record<string, string> = {
  success: "success",
  blocked: "blocked",
  dns_error: "dns error",
  timeout: "timeout",
  no_posts_found: "no posts found",
  error: "error",
};
const STATUS_TONE: Record<string, Segment["tone"]> = {
  success: "success",
  blocked: "warning",
  no_posts_found: "warning",
  dns_error: "danger",
  timeout: "danger",
  error: "danger",
};

const REASON_LABEL: Record<string, string> = {
  do_not_contact: "Do not contact",
  gov_edu_tld: "Gov/edu/mil",
  big_brand: "Big brand",
  excluded_domain: "Excluded domain",
  parked_domain: "Parked domain",
  url_shortener: "URL shortener",
  invalid_domain: "Invalid domain",
  redirected: "Redirected",
  gambling_content: "Gambling content",
  government_or_institutional: "Gov/institutional",
  not_a_business: "Not a business",
  needs_review: "Needs review",
  claimed_by_teammate: "Claimed by teammate",
};

const CONTACT_LABEL: Record<string, string> = {
  has_email: "Has email",
  form_only: "Form only (no email)",
  none: "Nothing found",
  blocked: "Blocked",
  failed: "Failed (timeout / DNS / error)",
  pending: "Not looked up yet",
};

// Rendered instead of the normal live Overview/Contact-results sections once
// a campaign's detail rows have been deleted (campaigns.archived_at is set)
// — see archiveCampaign in src/worker/archiveCampaign.ts. Reads only
// campaigns.archived_summary, a plain JSON snapshot frozen at the moment of
// deletion; nothing here queries the (now-empty) detail tables.
export function ArchivedCampaignSummary({ summary, archivedAt }: { summary: ArchivedSummary; archivedAt: Date }) {
  const statusSegments: Segment[] = summary.domainStatusCounts.map((s) => ({
    key: s.status,
    label: STATUS_LABEL[s.status] ?? s.status,
    value: s.count,
    tone: STATUS_TONE[s.status] ?? "neutral",
  }));

  const reasonSegments: Segment[] = summary.prospectReasonCounts.map((r) => ({
    key: r.reason ?? "kept",
    label: r.reason === null ? "Kept" : REASON_LABEL[r.reason] ?? r.reason,
    value: r.count,
    tone: r.reason === null ? "success" : "neutral",
  }));

  const contactSegments: Segment[] = [
    { key: "has_email", label: CONTACT_LABEL.has_email, value: summary.contactFilterCounts.has_email ?? 0, tone: "success" as const },
    { key: "form_only", label: CONTACT_LABEL.form_only, value: summary.contactFilterCounts.form_only ?? 0, tone: "info" as const },
    { key: "none", label: CONTACT_LABEL.none, value: summary.contactFilterCounts.none ?? 0, tone: "neutral" as const },
    { key: "failed", label: CONTACT_LABEL.failed, value: summary.contactFilterCounts.failed ?? 0, tone: "danger" as const },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
        <Archive size={16} />
        <span>
          This campaign's detailed data was cleaned up on {archivedAt.toLocaleDateString()} (a week after it completed) — showing
          the final summary only. The full breakdown and per-domain detail are in whatever Excel export was taken at the time.
        </span>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-text">Domains given: {summary.totalDomains}</h2>
        <ProportionBar segments={statusSegments} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-text">
          Unique backlink domains: {summary.linksCount} · Kept as prospects: {summary.contactStats.kept}
        </h2>
        <ProportionBar segments={reasonSegments} />
      </div>

      {summary.contactStats.looked > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-text">
            Contact results — reached {summary.contactStats.reached} of {summary.contactStats.looked} looked up (
            {summary.contactStats.totalEmails} email address{summary.contactStats.totalEmails === 1 ? "" : "es"} collected)
          </h2>
          <ProportionBar segments={contactSegments} />
        </div>
      )}
    </div>
  );
}

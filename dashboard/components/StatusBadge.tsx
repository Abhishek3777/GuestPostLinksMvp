type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_BY_STATUS: Record<string, Tone> = {
  success: "success",
  completed: "success",
  running: "info",
  queued: "neutral",
  paused: "warning",
  pausing: "warning",
  blocked: "warning",
  no_posts_found: "warning",
  dns_error: "danger",
  timeout: "danger",
  error: "danger",
  failed: "danger",
  // Stage 2 exclusion reasons
  do_not_contact: "danger",
  big_brand: "warning",
  gov_edu_tld: "warning",
  excluded_domain: "warning",
  parked_domain: "neutral",
  url_shortener: "neutral",
  invalid_domain: "neutral",
  already_found: "neutral", // a monitoring run: an earlier run already delivered this lead
  claimed_by_teammate: "neutral", // another campaign already kept this lead
  // Stage 3 contact status
  has_email: "success",
  form_only: "info",
  no_contact_found: "neutral",
  pending: "neutral",
};

const TONE_STYLES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-2 text-muted",
};

const DOT_STYLES: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE_BY_STATUS[status] ?? "neutral";
  const pulse = status === "running" || status === "queued" || status === "pausing";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_STYLES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[tone]} ${pulse ? "animate-pulse" : ""}`} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

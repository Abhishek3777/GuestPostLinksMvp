import { Clock } from "lucide-react";
import { formatDuration, formatFinishTime, type CampaignEta } from "@/lib/campaignEta";

// How a campaign's estimated finish is shown. How it is worked out:
// docs/CAMPAIGN_ETA.md. Always worded as an estimate — it is re-measured on
// every page load from how fast the campaign is going right now.
export function CampaignEtaLabel({ eta, variant }: { eta: CampaignEta; variant: "compact" | "full" }) {
  if (eta.kind === "none") return null;

  if (eta.kind === "paused") return <Line variant={variant} text="Paused — time left resumes when you press Resume" />;
  if (eta.kind === "queued") return <Line variant={variant} text="Waiting for a worker slot" />;
  if (eta.kind === "estimating") return <Line variant={variant} text={`Estimating… ${variant === "full" ? eta.reason : ""}`.trim()} />;

  const range = `${formatDuration(eta.lowMs)} – ${formatDuration(eta.highMs)}`;
  const finish = formatFinishTime(eta.finishAt);
  const detail = `Estimated range ${range}. Expected to finish around ${finish} IST. This is re-worked out from the campaign's current speed and will change if it speeds up or slows down.`;

  if (variant === "compact") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted" title={`${detail}${eta.partial ? ` Note: ${eta.partial}.` : ""}`}>
        <Clock size={11} /> ~{formatDuration(eta.expectedMs)} left{eta.partial ? "*" : ""}
      </span>
    );
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted" title={detail}>
      <Clock size={14} className="text-accent" />
      <span>
        Estimated <span className="font-medium text-text">{range}</span> left · finishes around{" "}
        <span className="font-medium text-text">{finish}</span> IST
      </span>
      {eta.partial && <span className="text-xs">({eta.partial})</span>}
    </p>
  );
}

function Line({ variant, text }: { variant: "compact" | "full"; text: string }) {
  return variant === "compact" ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Clock size={11} /> {text}
    </span>
  ) : (
    <p className="mt-1 flex items-center gap-2 text-sm text-muted">
      <Clock size={14} /> {text}
    </p>
  );
}

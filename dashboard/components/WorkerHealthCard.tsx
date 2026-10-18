import { Activity } from "lucide-react";
import type { WorkerHealth } from "@/services/workerHealth.service";
import { AutoRefresh } from "./AutoRefresh";

function ago(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const LOOK = {
  healthy: { label: "Worker healthy", dot: "bg-success", box: "bg-success-soft text-success" },
  stale: { label: "Worker not responding", dot: "bg-warning", box: "bg-warning-soft text-warning" },
  down: { label: "Worker is down", dot: "bg-danger", box: "bg-danger-soft text-danger" },
  unknown: { label: "Worker status unknown", dot: "bg-muted", box: "bg-surface-2 text-muted" },
} as const;

export function WorkerHealthCard({ health }: { health: WorkerHealth }) {
  const look = LOOK[health.state];
  const bad = health.state === "stale" || health.state === "down";

  let detail: string;
  if (health.state === "unknown") {
    detail = "No heartbeat recorded yet — the worker needs to be redeployed once with the health check.";
  } else if (health.state === "healthy") {
    detail = `Last beat ${ago(health.lastBeatAgoS!)} ago · up ${ago(health.uptimeS!)}`;
  } else {
    detail = `Last beat ${ago(health.lastBeatAgoS!)} ago`;
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-4 ${bad ? "border-danger/40 bg-danger-soft" : "border-border bg-surface"}`}>
      {/* Page data is server-rendered; re-fetching it is what keeps this live. */}
      <AutoRefresh intervalMs={15000} />
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${look.box}`}>
        <Activity size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <span className={`h-2 w-2 shrink-0 rounded-full ${look.dot} ${health.state === "healthy" ? "animate-pulse" : ""}`} />
          {look.label}
        </div>
        <div className="mt-0.5 text-xs text-muted">{detail}</div>
      </div>
      <div className="flex gap-4 text-xs text-muted">
        <span>
          <span className="font-semibold text-text">{health.runningJobs}</span> running
        </span>
        <span>
          <span className="font-semibold text-text">{health.queuedJobs}</span> queued
        </span>
      </div>
      {bad && (health.runningJobs > 0 || health.queuedJobs > 0) && (
        <p className="w-full text-xs text-danger">
          Jobs are waiting on a worker that isn&apos;t responding — restart the worker service. Interrupted jobs resume automatically.
        </p>
      )}
    </div>
  );
}

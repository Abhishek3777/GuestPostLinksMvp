import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Filter, Link2, Radar } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDomainAnalytics } from "@/services/analytics.service";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityToggle } from "@/components/PriorityToggle";

export const dynamic = "force-dynamic";

function formatWhen(d: Date | null): string {
  if (!d) return "Never run";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function DomainAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const { id } = await params;
  const data = await getDomainAnalytics(id, user);
  if (!data) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/analytics" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft size={14} /> Back to Analytics
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text">{data.domain}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${data.active ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}>
            {data.active ? "Active" : "Paused"}
          </span>
          {user.role === "admin" && <PriorityToggle id={data.id} isPriority={data.isPriority} />}
        </div>
        <p className="mt-1 text-sm text-muted">
          {data.ownerEmail ? `Added by ${data.ownerEmail}` : "Added before ownership existed"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="All-time backlinks" value={data.totalLinksFound.toLocaleString()} icon={Link2} tone="success" />
        <StatCard label="All-time guest posts" value={data.totalPostsFound.toLocaleString()} icon={Radar} tone="info" />
        <StatCard label="Last run backlinks" value={data.lastRunLinks?.toLocaleString() ?? "—"} icon={Link2} tone="neutral" />
        <StatCard
          label="Last run"
          value={data.lastCampaignId ? formatWhen(data.lastRunAt) : "Never run"}
          icon={Radar}
          tone="neutral"
        />
      </div>

      {data.lastCampaignId && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">Last run</h2>
            {data.crawlStatus && <StatusBadge status={data.crawlStatus} />}
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-muted">Campaign</dt>
              <dd className="mt-0.5 text-text">
                <Link href={`/campaigns/${data.lastCampaignId}`} className="hover:text-accent hover:underline">
                  {data.lastCampaignName ?? data.lastCampaignId}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted">Posts processed</dt>
              <dd className="mt-0.5 text-text">{data.lastRunPostsProcessed ?? "—"}</dd>
            </div>
            {data.crawlReason && (
              <div>
                <dt className="text-xs font-medium text-muted">Reason</dt>
                <dd className="mt-0.5 text-text">{data.crawlReason}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-text">Filters applied</h2>
        </div>
        <p className="mt-1 text-xs text-muted">
          Last run only — exclusion/filter detail isn&apos;t kept all-time yet (it&apos;s deleted a week after a campaign
          completes, same as the raw backlink rows used to be before the all-time counters above existed).
        </p>
        {!data.lastRunFilterBreakdown || data.lastRunFilterBreakdown.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {data.lastCampaignId ? "No filter detail available for the last run." : "No run yet."}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.lastRunFilterBreakdown.map((f) => (
              <span key={f.reason} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text">
                {f.reason.replace(/_/g, " ")}
                <span className="text-muted">× {f.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

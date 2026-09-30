import Link from "next/link";
import { FolderKanban, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import { redirect } from "next/navigation";
import { listCampaigns } from "@/services/campaigns.service";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";
import { ExportMenu } from "@/components/ExportMenu";
import { PauseResumeButton } from "@/components/PauseResumeButton";
import { canPauseOrResume, displayStatus, isActive } from "@/lib/campaignState";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin";
  const campaigns = await listCampaigns(isAdmin ? undefined : user.id);

  const totalProspects = campaigns.reduce((sum, c) => sum + c.keptProspects, 0);
  // A campaign parked by Pause is not "running now".
  const runningCount = campaigns.filter((c) => isActive(c) && displayStatus(c) !== "paused").length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Campaigns</h1>
        <p className="mt-1 text-sm text-muted">Every crawl run, past and in progress.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total campaigns" value={campaigns.length} icon={FolderKanban} tone="info" />
        <StatCard label="Prospects kept" value={totalProspects} icon={ShieldCheck} tone="success" />
        <StatCard label="Running now" value={runningCount} icon={Loader2} tone={runningCount ? "warning" : "neutral"} />
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <FolderKanban size={20} />
          </div>
          <p className="text-sm text-muted">No campaigns yet.</p>
          <Link href="/campaigns/new" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Start your first crawl <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-5 py-3">Campaign</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Progress</th>
                <th className="px-5 py-3">Prospects</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3">Export</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="group border-b border-border last:border-0 transition-colors hover:bg-surface-2">
                  <td className="px-5 py-4">
                    <Link href={`/campaigns/${c.id}`} className="whitespace-nowrap font-medium text-text group-hover:text-accent">
                      {c.name}
                    </Link>
                    {isAdmin && (
                      <div className="mt-0.5 max-w-[14rem] truncate text-xs text-muted" title={c.ownerEmail ?? undefined}>
                        {c.ownerEmail ?? <span className="italic">Unassigned</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {c.mode === "direct" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">
                        Contact lookup
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                        Full pipeline
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={displayStatus(c)} />
                      {canPauseOrResume(c) && <PauseResumeButton campaignId={c.id} action={canPauseOrResume(c)!} compact />}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {c.mode === "direct" ? (
                      <StatusBadge status={c.paused && isActive(c) ? displayStatus(c) : c.contactStageStatus} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${c.totalDomains ? (c.domainsChecked / c.totalDomains) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted">
                          {c.domainsChecked}/{c.totalDomains}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 font-medium text-text">{c.keptProspects}</td>
                  <td className="px-5 py-4 text-muted">
                    {new Date(c.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      // This renders server-side (Railway's container clock, not
                      // the viewer's) — without a fixed zone this would show UTC.
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td className="px-5 py-4">
                    {(c.status === "completed" || c.domainsChecked > 0 || c.keptProspects > 0) && (
                      <div className="flex gap-2">
                        <ExportMenu campaignId={c.id} mode={c.mode} format="xlsx" label="Excel" />
                        <ExportMenu campaignId={c.id} mode={c.mode} format="csv" label="CSV" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

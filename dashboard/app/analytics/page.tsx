import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Link2, Pin, Trophy } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listLeaderboard, listPrioritySites } from "@/services/analytics.service";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { PriorityToggle } from "@/components/PriorityToggle";
import { RunSitesButton } from "@/components/SitesControls";
import { AnalyticsSearch } from "@/components/AnalyticsSearch";

export const dynamic = "force-dynamic";

function formatWhen(d: Date | null): string {
  if (!d) return "Never run";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const { tab: tabParam, q: qParam } = await searchParams;
  const tab = tabParam === "priority" ? "priority" : "leaderboard";
  const q = qParam?.trim() || undefined;

  // Stat cards always reflect the TRUE totals, never the filtered search
  // result — only re-fetched (filtered) when a search is active, so the
  // common no-search case stays a single pair of queries.
  const [leaderboardAll, prioritySitesAll] = await Promise.all([listLeaderboard(user), listPrioritySites(user)]);
  const [leaderboard, prioritySites] = q
    ? await Promise.all([listLeaderboard(user, q), listPrioritySites(user, q)])
    : [leaderboardAll, prioritySitesAll];
  const rows = tab === "priority" ? prioritySites : leaderboard;
  const flaggedCount = leaderboardAll.filter((r) => r.looksEmptyButHasHistory).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Analytics</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          How much every domain has actually produced, all time — not just its last run.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Domains tracked" value={leaderboardAll.length.toLocaleString()} icon={Link2} tone="info" />
        <StatCard label="Priority sites" value={prioritySitesAll.length.toLocaleString()} icon={Pin} tone="success" />
        <StatCard
          label="Worth a second look"
          value={flaggedCount.toLocaleString()}
          icon={AlertTriangle}
          tone={flaggedCount > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <AnalyticsTabs selected={tab} counts={{ leaderboard: leaderboardAll.length, priority: prioritySitesAll.length }} />
          <AnalyticsSearch tab={tab} />
        </div>
        {tab === "priority" && user.role === "admin" && (
          <RunSitesButton activeCount={prioritySitesAll.length} endpoint="/api/sites/run-priority" label="Run priority sites" />
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Trophy size={20} />
          </div>
          <p className="text-sm text-muted">
            {q
              ? `No domains matching "${q}".`
              : tab === "priority"
                ? "No priority sites marked yet — mark some from the leaderboard below."
                : "No sites yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="w-10 px-5 py-3"></th>
                <th className="px-5 py-3">Domain</th>
                {user.role === "admin" && <th className="px-5 py-3">Owner</th>}
                <th className="px-5 py-3">All-time backlinks</th>
                <th className="px-5 py-3">All-time posts</th>
                <th className="px-5 py-3">Last run</th>
                <th className="px-5 py-3">Last result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-5 py-3">
                    {user.role === "admin" && <PriorityToggle id={r.id} isPriority={r.isPriority} />}
                  </td>
                  <td className="px-5 py-3 font-medium text-text">
                    <Link href={`/analytics/${r.id}`} className="hover:text-accent hover:underline">
                      {r.domain}
                    </Link>
                    {r.looksEmptyButHasHistory && (
                      <span
                        title="Last run looks empty or blocked, but this domain has real all-time history — worth a second look, not necessarily actually broken."
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning"
                      >
                        <AlertTriangle size={10} /> check this
                      </span>
                    )}
                  </td>
                  {user.role === "admin" && <td className="px-5 py-3 text-muted">{r.ownerEmail ?? "— (legacy)"}</td>}
                  <td className="px-5 py-3 font-medium text-text">{r.totalLinksFound.toLocaleString()}</td>
                  <td className="px-5 py-3 text-muted">{r.totalPostsFound.toLocaleString()}</td>
                  <td className="px-5 py-3 text-muted">{formatWhen(r.lastRunAt)}</td>
                  <td className="px-5 py-3">{r.crawlStatus ? <StatusBadge status={r.crawlStatus} /> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, Pause, Play, Radar } from "lucide-react";
import { listSites, SITES_PAGE_SIZE, type SiteFilter } from "@/services/sites.service";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { SiteActiveToggle } from "@/components/SiteActiveToggle";
import { DeleteSiteButton } from "@/components/DeleteSiteButton";
import { SitesAddForm } from "@/components/SitesAddForm";
import { RunSitesButton, SitesBulkActions, SitesFilters } from "@/components/SitesControls";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function formatWhen(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const { q = "", filter: filterParam, page: pageParam } = await searchParams;
  const filter: SiteFilter = filterParam === "active" || filterParam === "paused" ? filterParam : "all";
  const page = Math.max(1, Number(pageParam) || 1);

  const { sites, total, pageCount, activeTotal, allTotal, latestCampaignId } = await listSites({
    q: q.trim() || undefined,
    filter,
    page,
  });
  const pausedTotal = allTotal - activeTotal;
  const running = sites.some(
    (s) =>
      s.campaignStatus === "queued" ||
      s.campaignStatus === "running" ||
      s.contactStageStatus === "queued" ||
      s.contactStageStatus === "running"
  );

  function pageHref(target: number) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (filter !== "all") p.set("filter", filter);
    if (target > 1) p.set("page", String(target));
    const qs = p.toString();
    return qs ? `/sites?${qs}` : "/sites";
  }

  return (
    <div className="flex flex-col gap-6">
      {running && <AutoRefresh />}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Sites to monitor</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Your standing list of guest-post sites. Switch a site on or off, then run the active ones: only posts
            published since the last run are read, and only leads not found before are handed over.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RunSitesButton activeCount={activeTotal} />
          {latestCampaignId && (
            <Link
              href={`/campaigns/${latestCampaignId}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Latest run&apos;s results <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Sites in the list" value={allTotal.toLocaleString()} icon={Radar} tone="info" />
        <StatCard label="Active (will run)" value={activeTotal.toLocaleString()} icon={Play} tone="success" />
        <StatCard label="Paused" value={pausedTotal.toLocaleString()} icon={Pause} tone="neutral" />
      </div>

      <SitesAddForm />

      <div className="flex flex-col gap-3">
        <SitesFilters counts={{ all: allTotal, active: activeTotal, paused: pausedTotal }} />
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {total.toLocaleString()} site{total === 1 ? "" : "s"}
            {q ? ` matching “${q}”` : ""}
          </span>
          <SitesBulkActions visibleCount={total} />
        </div>
      </div>

      {sites.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Radar size={20} />
          </div>
          <p className="text-sm text-muted">
            {allTotal === 0 ? "No sites yet — add some above." : "No sites match this view."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-5 py-3">Active</th>
                <th className="px-5 py-3">Domain</th>
                <th className="px-5 py-3">Last run</th>
                <th className="px-5 py-3">Last result</th>
                <th className="px-5 py-3">Backlinks</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => {
                const inProgress =
                  s.campaignStatus === "queued" ||
                  s.campaignStatus === "running" ||
                  s.contactStageStatus === "queued" ||
                  s.contactStageStatus === "running";
                return (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <SiteActiveToggle id={s.id} domain={s.domain} active={s.active} />
                    </td>
                    <td className={`px-5 py-3 font-medium ${s.active ? "text-text" : "text-muted"}`}>{s.domain}</td>
                    <td className="px-5 py-3 text-muted">
                      {s.lastCampaignId ? (
                        <Link href={`/campaigns/${s.lastCampaignId}`} className="hover:text-accent hover:underline">
                          {formatWhen(s.lastRunAt)}
                        </Link>
                      ) : (
                        "Never run"
                      )}
                    </td>
                    <td className="px-5 py-3" title={s.crawlReason ?? undefined}>
                      {!s.lastCampaignId ? (
                        <span className="text-muted">—</span>
                      ) : inProgress ? (
                        <StatusBadge status={s.campaignStatus === "queued" ? "queued" : "running"} />
                      ) : s.crawlStatus ? (
                        <StatusBadge status={s.crawlStatus} />
                      ) : (
                        <span className="text-muted">not reached</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{s.links === null ? "—" : s.links.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      <DeleteSiteButton id={s.id} domain={s.domain} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Page {page} of {pageCount} · {SITES_PAGE_SIZE} per page
          </span>
          <div className="flex gap-2">
            <Link
              href={pageHref(page - 1)}
              aria-disabled={page <= 1}
              className={`rounded-lg border border-border px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
            >
              Previous
            </Link>
            <Link
              href={pageHref(page + 1)}
              aria-disabled={page >= pageCount}
              className={`rounded-lg border border-border px-3 py-1.5 ${page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

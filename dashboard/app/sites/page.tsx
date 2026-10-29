import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Pause, Play, Radar } from "lucide-react";
import {
  listSites,
  listSiteOwnerCounts,
  listAllMembers,
  countUnassignedSites,
  SITES_PAGE_SIZE,
  type SiteFilter,
} from "@/services/sites.service";
import { getCurrentUser } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";
import { SitesAddForm } from "@/components/SitesAddForm";
import { RunSitesButton, SitesFilters, SitesOwnerFilter } from "@/components/SitesControls";
import { SitesTable } from "@/components/SitesTable";

export const dynamic = "force-dynamic";

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; owner?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const { q = "", filter: filterParam, page: pageParam, owner: ownerParam } = await searchParams;
  const filter: SiteFilter = filterParam === "active" || filterParam === "paused" ? filterParam : "all";
  const page = Math.max(1, Number(pageParam) || 1);
  // Owner filter only ever applies for an admin — a member's own scope is
  // already enforced server-side regardless of what's in the URL.
  const ownerId = user.role === "admin" && ownerParam ? ownerParam : undefined;

  const [{ sites, total, pageCount, activeTotal, allTotal, latestCampaignId }, owners, unassignedCount, members] = await Promise.all([
    listSites({ q: q.trim() || undefined, filter, page, viewer: user, ownerId }),
    user.role === "admin" ? listSiteOwnerCounts() : Promise.resolve([]),
    user.role === "admin" ? countUnassignedSites() : Promise.resolve(0),
    user.role === "admin" ? listAllMembers() : Promise.resolve([]),
  ]);
  const pausedTotal = allTotal - activeTotal;

  function pageHref(target: number) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (filter !== "all") p.set("filter", filter);
    if (ownerId) p.set("owner", ownerId);
    if (target > 1) p.set("page", String(target));
    const qs = p.toString();
    return qs ? `/sites?${qs}` : "/sites";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Sites to monitor</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {user.role === "admin"
              ? "Every member's standing list of guest-post sites — filter below to see one person's. Switch a site on or off, then run the active ones: only posts published since the last run are read, and only leads not found before are handed over."
              : "Your standing list of guest-post sites. Switch a site on or off, then run the active ones: only posts published since the last run are read, and only leads not found before are handed over."}
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

      <SitesAddForm members={user.role === "admin" ? members : undefined} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SitesFilters counts={{ all: allTotal, active: activeTotal, paused: pausedTotal }} />
          {user.role === "admin" && (
            <SitesOwnerFilter owners={owners} unassignedCount={unassignedCount} selected={ownerId} />
          )}
        </div>
        <span className="text-xs text-muted">
          {total.toLocaleString()} site{total === 1 ? "" : "s"}
          {q ? ` matching “${q}”` : ""}
          {ownerId === "unassigned" ? " · added before ownership existed" : ""}
          {ownerId && ownerId !== "unassigned" ? ` · added by ${owners.find((o) => o.id === ownerId)?.email ?? "this member"}` : ""}
        </span>
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
        <SitesTable
          sites={sites}
          showOwner={user.role === "admin"}
          total={total}
          matchQuery={{ q: q.trim() || undefined, filter, ownerId }}
          members={user.role === "admin" ? members : undefined}
        />
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

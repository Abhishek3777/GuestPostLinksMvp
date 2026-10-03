import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe, Link2, ShieldAlert, CheckCircle2 } from "lucide-react";
import {
  getCampaignDetail,
  getCampaignEtas,
  getCampaignOwnerEmail,
  getCampaignProspectReasonCounts,
  getCampaignProspectsPage,
  getCampaignRetryableCount,
} from "@/services/campaigns.service";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCampaign } from "@/lib/campaignAccess";
import { CampaignEtaLabel } from "@/components/CampaignEtaLabel";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";
import { ExportMenu } from "@/components/ExportMenu";
import { RunContactStageButton } from "@/components/RunContactStageButton";
import { PauseResumeButton } from "@/components/PauseResumeButton";
import { RetryFailedButton } from "@/components/RetryFailedButton";
import { DeleteCampaignButton } from "@/components/DeleteCampaignButton";
import { CampaignTabs } from "@/components/CampaignTabs";
import { canPauseOrResume, displayStatus, isActive } from "@/lib/campaignState";
import { DomainStatusSection } from "@/components/DomainStatusSection";
import { ProspectsSection } from "@/components/ProspectsSection";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dpage?: string; dstatus?: string; dsearch?: string; ppage?: string; preason?: string; psearch?: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !(await canAccessCampaign(id, user))) notFound();

  const { dpage, dstatus, dsearch, ppage, preason, psearch } = await searchParams;
  const domainPage = Math.max(1, Number(dpage) || 1);

  const detail = await getCampaignDetail(id, { domainPage, domainStatus: dstatus, domainSearch: dsearch || undefined });
  if (!detail) notFound();

  const { campaign, domainStatuses, domainStatusesTotal, domainStatusesPageCount, domainStatusCounts, linksCount, totalDomains } = detail;

  const contactStageStarted = campaign.contactStageStatus !== "not_started";
  const ownerEmail = user.role === "admin" ? await getCampaignOwnerEmail(campaign.createdBy) : null;
  const eta = (await getCampaignEtas([campaign])).get(campaign.id) ?? { kind: "none" as const };

  // The Stage 2 prospect breakdown/table only ever shows here BEFORE contact stage
  // starts — once it does, this moves to its own tab (see CampaignTabs).
  const [reasonCounts, retryableCount] = await Promise.all([
    getCampaignProspectReasonCounts(id),
    getCampaignRetryableCount(id),
  ]);
  const prospectsPage = !contactStageStarted
    ? await getCampaignProspectsPage(id, {
        page: Math.max(1, Number(ppage) || 1),
        reason: preason || undefined,
        search: psearch || undefined,
      })
    : null;

  const keptCount = reasonCounts.find((r) => r.reason === null)?.count ?? 0;
  const totalProspects = reasonCounts.reduce((sum, r) => sum + r.count, 0);

  // Keep refreshing while work is happening (including "pausing"), but not once it
  // is parked — a paused campaign sits still until someone resumes it.
  const shownStatus = displayStatus(campaign);
  const isLive = isActive(campaign) && shownStatus !== "paused";
  const pauseAction = canPauseOrResume(campaign);
  const canRetry = !isActive(campaign) && campaign.status === "completed" && retryableCount > 0;
  const successCount = domainStatusCounts.find((s) => s.status === "success")?.count ?? 0;
  const blockedCount = domainStatusCounts.find((s) => s.status === "blocked")?.count ?? 0;

  const canRunContactStage =
    campaign.mode === "discovery" && campaign.status === "completed" && campaign.contactStageStatus === "not_started";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft size={14} /> Campaigns
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-text">{campaign.name}</h1>
            <StatusBadge status={shownStatus} />
            {campaign.mode === "direct" && (
              <span className="rounded-full bg-info-soft px-2.5 py-1 text-xs font-medium text-info">direct</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {pauseAction && <PauseResumeButton campaignId={campaign.id} action={pauseAction} />}
            {canRetry && <RetryFailedButton campaignId={campaign.id} count={retryableCount} />}
            {canRunContactStage && keptCount > 0 && <RunContactStageButton campaignId={campaign.id} />}
            {(totalProspects > 0 || domainStatusesTotal > 0) && (
              <>
                <ExportMenu campaignId={campaign.id} mode={campaign.mode} format="xlsx" label="Export Excel" />
                <ExportMenu campaignId={campaign.id} mode={campaign.mode} format="csv" label="Export CSV" />
              </>
            )}
            {/* Page access already means admin-or-owner (canAccessCampaign above),
                so no extra role check is needed to show this. */}
            <DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
          </div>
        </div>
        {user.role === "admin" && (
          <p className="mt-1 text-sm text-muted">
            Started by <span className="font-medium text-text">{ownerEmail ?? "Unassigned (created before accounts)"}</span>
          </p>
        )}
        <CampaignEtaLabel eta={eta} variant="full" />
        {campaign.mode === "discovery" && (
          <p className="mt-1 text-sm text-muted">
            {campaign.targetPostCount >= 1000 ? "No limit" : `Up to ${campaign.targetPostCount}`} posts/domain
            {campaign.daysWindow ? ` · last ${campaign.daysWindow} days` : ""}
          </p>
        )}
      </div>

      {/* Top of the page, not the bottom — with a few thousand Stage 1 rows below,
          a link buried under them would never be reached by scrolling. */}
      <CampaignTabs campaignId={id} active="overview" contactStageStarted={contactStageStarted} />

      {campaign.mode === "discovery" && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Domains given" value={totalDomains} icon={Globe} tone="info" />
          <StatCard label="Visitable, no bypass" value={successCount} icon={CheckCircle2} tone="success" />
          <StatCard label="Couldn't bypass" value={blockedCount} icon={ShieldAlert} tone={blockedCount ? "warning" : "neutral"} />
          <StatCard label="Links found" value={linksCount} icon={Link2} tone="success" />
        </div>
      )}

      <DomainStatusSection
        rows={domainStatuses}
        statusCounts={domainStatusCounts}
        total={domainStatusesTotal}
        page={domainPage}
        pageCount={domainStatusesPageCount}
        isLive={isLive}
      />

      {!contactStageStarted && prospectsPage && totalProspects > 0 && (
        <ProspectsSection
          rows={prospectsPage.rows}
          reasonCounts={reasonCounts}
          total={prospectsPage.total}
          page={Math.max(1, Number(ppage) || 1)}
          pageCount={prospectsPage.pageCount}
          contactStageStarted={false}
        />
      )}

      {totalProspects === 0 && domainStatusesTotal === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          {isLive ? "Waiting for the worker to start reporting…" : "No results yet."}
        </p>
      )}
    </div>
  );
}

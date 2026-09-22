import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe, Link2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { getCampaignDetail } from "@/services/campaigns.service";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ExportMenu } from "@/components/ExportMenu";
import { RunContactStageButton } from "@/components/RunContactStageButton";
import { PauseResumeButton } from "@/components/PauseResumeButton";
import { ContactDashboard } from "@/components/ContactDashboard";
import { RetryFailedButton } from "@/components/RetryFailedButton";
import { canPauseOrResume, displayStatus, isActive } from "@/lib/campaignState";
import { DomainStatusSection } from "@/components/DomainStatusSection";
import { ProspectsSection } from "@/components/ProspectsSection";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCampaignDetail(id);
  if (!detail) notFound();

  const { campaign, domainStatuses, links, prospects, totalDomains } = detail;
  // Keep refreshing while work is happening (including "pausing"), but not once it
  // is parked — a paused campaign sits still until someone resumes it.
  const shownStatus = displayStatus(campaign);
  const isLive = isActive(campaign) && shownStatus !== "paused";
  const pauseAction = canPauseOrResume(campaign);
  const retryableCount = prospects.filter(
    (p) => !p.exclusionReason && ["blocked", "timeout", "dns_error", "error"].includes(p.contactStatus)
  ).length;
  const canRetry = !isActive(campaign) && campaign.status === "completed" && retryableCount > 0;
  const successCount = domainStatuses.filter((d) => d.status === "success").length;
  const blockedCount = domainStatuses.filter((d) => d.status === "blocked").length;

  const keptProspects = prospects.filter((p) => !p.exclusionReason);
  const contactChecked = keptProspects.filter((p) => p.contactCheckedAt);

  const canRunContactStage =
    campaign.mode === "discovery" && campaign.status === "completed" && campaign.contactStageStatus === "not_started";
  const contactStageStarted = campaign.contactStageStatus !== "not_started";

  return (
    <div className="flex flex-col gap-8">
      {isLive && <AutoRefresh />}

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
            {canRunContactStage && keptProspects.length > 0 && <RunContactStageButton campaignId={campaign.id} />}
            {(prospects.length > 0 || domainStatuses.length > 0) && (
              <>
                <ExportMenu campaignId={campaign.id} mode={campaign.mode} format="xlsx" label="Export Excel" />
                <ExportMenu campaignId={campaign.id} mode={campaign.mode} format="csv" label="Export CSV" />
              </>
            )}
          </div>
        </div>
        {campaign.mode === "discovery" && (
          <p className="mt-1 text-sm text-muted">
            {campaign.targetPostCount >= 1000 ? "No limit" : `Up to ${campaign.targetPostCount}`} posts/domain
            {campaign.daysWindow ? ` · last ${campaign.daysWindow} days` : ""}
          </p>
        )}
      </div>

      {campaign.mode === "discovery" && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Domains given" value={totalDomains} icon={Globe} tone="info" />
          <StatCard label="Visitable, no bypass" value={successCount} icon={CheckCircle2} tone="success" />
          <StatCard label="Couldn't bypass" value={blockedCount} icon={ShieldAlert} tone={blockedCount ? "warning" : "neutral"} />
          <StatCard label="Links found" value={links.length} icon={Link2} tone="success" />
        </div>
      )}

      <DomainStatusSection domainStatuses={domainStatuses} isLive={isLive} />

      {contactStageStarted && (
        <ContactDashboard
          prospects={prospects}
          stageStatus={campaign.paused && isActive(campaign) ? shownStatus : campaign.contactStageStatus}
        />
      )}

      {prospects.length > 0 && <ProspectsSection prospects={prospects} contactStageStarted={contactStageStarted} />}

      {prospects.length === 0 && domainStatuses.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          {isLive ? "Waiting for the worker to start reporting…" : "No results yet."}
        </p>
      )}
    </div>
  );
}

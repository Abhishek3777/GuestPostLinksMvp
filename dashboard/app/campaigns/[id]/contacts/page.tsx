import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getCampaign,
  getCampaignBlockedReasons,
  getCampaignContactFilterCounts,
  getCampaignContactStats,
  getCampaignProspectReasonCounts,
  getCampaignProspectsPage,
} from "@/services/campaigns.service";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCampaign } from "@/lib/campaignAccess";
import { StatusBadge } from "@/components/StatusBadge";
import { ContactDashboard } from "@/components/ContactDashboard";
import { ProspectsSection } from "@/components/ProspectsSection";
import { CampaignTabs } from "@/components/CampaignTabs";
import { displayStatus, isActive } from "@/lib/campaignState";

export const dynamic = "force-dynamic";

// Split out of the main campaign page: with a few thousand Stage 1 domains
// rendered above it, the contact results were effectively unreachable — you'd
// have to scroll past all of them first. This is its own page instead, linked
// from the main page once there's something here to look at.
//
// Every query here is either a bounded page of rows (ROWS_PAGE_SIZE) or a
// lightweight aggregate — nothing here scales with how big the campaign is.
export default async function CampaignContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ppage?: string; preason?: string; pcontact?: string; psearch?: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !(await canAccessCampaign(id, user))) notFound();

  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const contactStageStarted = campaign.contactStageStatus !== "not_started";
  if (!contactStageStarted) notFound();

  const { ppage, preason, pcontact, psearch } = await searchParams;
  const page = Math.max(1, Number(ppage) || 1);

  const [stats, filterCounts, blockedReasons, reasonCounts, prospectsPage] = await Promise.all([
    getCampaignContactStats(id),
    getCampaignContactFilterCounts(id),
    getCampaignBlockedReasons(id),
    getCampaignProspectReasonCounts(id),
    getCampaignProspectsPage(id, { page, reason: preason || undefined, contact: pcontact || undefined, search: psearch || undefined }),
  ]);

  const shownStatus = displayStatus(campaign);
  const stageStatus = campaign.paused && isActive(campaign) ? shownStatus : campaign.contactStageStatus;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/campaigns/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft size={14} /> {campaign.name}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Contact results</h1>
          <StatusBadge status={stageStatus} />
        </div>
      </div>

      <CampaignTabs campaignId={id} active="contacts" contactStageStarted={contactStageStarted} />

      <ContactDashboard stats={stats} filterCounts={filterCounts} blockedReasons={blockedReasons} stageStatus={stageStatus} />

      {stats.kept > 0 && (
        <ProspectsSection
          rows={prospectsPage.rows}
          reasonCounts={reasonCounts}
          contactFilterCounts={filterCounts}
          total={prospectsPage.total}
          page={page}
          pageCount={prospectsPage.pageCount}
          contactStageStarted={contactStageStarted}
        />
      )}
    </div>
  );
}

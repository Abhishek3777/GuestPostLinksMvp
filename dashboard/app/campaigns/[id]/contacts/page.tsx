import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCampaignDetail } from "@/services/campaigns.service";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCampaign } from "@/lib/campaignAccess";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ContactDashboard } from "@/components/ContactDashboard";
import { ProspectsSection } from "@/components/ProspectsSection";
import { displayStatus, isActive } from "@/lib/campaignState";

export const dynamic = "force-dynamic";

// Split out of the main campaign page: with a few thousand Stage 1 domains
// rendered above it, the contact results were effectively unreachable — you'd
// have to scroll past all of them first. This is its own page instead, linked
// from the main page once there's something here to look at.
export default async function CampaignContactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !(await canAccessCampaign(id, user))) notFound();

  const detail = await getCampaignDetail(id);
  if (!detail) notFound();

  const { campaign, prospects } = detail;
  const contactStageStarted = campaign.contactStageStatus !== "not_started";
  if (!contactStageStarted) notFound();

  const shownStatus = displayStatus(campaign);
  const isLive = isActive(campaign) && shownStatus !== "paused";

  return (
    <div className="flex flex-col gap-8">
      {isLive && <AutoRefresh />}

      <div>
        <Link href={`/campaigns/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft size={14} /> {campaign.name}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Contact results</h1>
          <StatusBadge status={campaign.paused && isActive(campaign) ? shownStatus : campaign.contactStageStatus} />
        </div>
      </div>

      <ContactDashboard
        prospects={prospects}
        stageStatus={campaign.paused && isActive(campaign) ? shownStatus : campaign.contactStageStatus}
      />

      {prospects.length > 0 && <ProspectsSection prospects={prospects} contactStageStarted={contactStageStarted} />}
    </div>
  );
}

import { NextResponse } from "next/server";
import { deleteCampaign } from "@/services/campaigns.service";
import { requireCampaignAccess } from "@/lib/campaignAccess";

// Admin: any campaign. Everyone else: only their own — requireCampaignAccess
// enforces that, same rule as every other campaign mutation.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCampaignAccess(id);
  if ("response" in access) return access.response;

  await deleteCampaign(id);
  return NextResponse.json({ ok: true });
}

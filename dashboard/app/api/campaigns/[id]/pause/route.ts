import { NextResponse } from "next/server";
import { pauseCampaign } from "@/services/campaigns.service";
import { requireCampaignAccess } from "@/lib/campaignAccess";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCampaignAccess(id);
  if ("response" in access) return access.response;

  await pauseCampaign(id);
  return NextResponse.json({ ok: true });
}

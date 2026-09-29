import { NextResponse } from "next/server";
import { resumeCampaign } from "@/services/campaigns.service";
import { requireCampaignAccess } from "@/lib/campaignAccess";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCampaignAccess(id);
  if ("response" in access) return access.response;

  await resumeCampaign(id);
  return NextResponse.json({ ok: true });
}

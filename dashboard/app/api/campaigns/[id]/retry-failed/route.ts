import { NextResponse } from "next/server";
import { retryFailedContacts } from "@/services/campaigns.service";
import { requireCampaignAccess } from "@/lib/campaignAccess";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCampaignAccess(id);
  if ("response" in access) return access.response;

  const result = await retryFailedContacts(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}

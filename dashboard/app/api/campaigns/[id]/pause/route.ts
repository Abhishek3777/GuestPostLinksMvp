import { NextResponse } from "next/server";
import { pauseCampaign } from "@/services/campaigns.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pauseCampaign(id);
  return NextResponse.json({ ok: true });
}

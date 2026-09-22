import { NextResponse } from "next/server";
import { resumeCampaign } from "@/services/campaigns.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await resumeCampaign(id);
  return NextResponse.json({ ok: true });
}

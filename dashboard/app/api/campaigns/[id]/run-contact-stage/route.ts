import { NextResponse } from "next/server";
import { startContactStage } from "@/services/campaigns.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await startContactStage(id);
  return NextResponse.json({ ok: true });
}

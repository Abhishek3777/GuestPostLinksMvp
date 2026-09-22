import { NextResponse } from "next/server";
import { retryFailedContacts } from "@/services/campaigns.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await retryFailedContacts(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}

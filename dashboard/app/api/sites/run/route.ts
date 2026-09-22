import { NextResponse } from "next/server";
import { runActiveSites } from "@/services/sites.service";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const result = await runActiveSites(typeof body.name === "string" ? body.name : undefined);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}

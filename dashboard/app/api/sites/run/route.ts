import { NextResponse } from "next/server";
import { runActiveSites } from "@/services/sites.service";

export async function POST() {
  const result = await runActiveSites();
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}

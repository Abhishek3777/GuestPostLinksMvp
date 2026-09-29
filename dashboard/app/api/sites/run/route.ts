import { NextResponse } from "next/server";
import { runActiveSites } from "@/services/sites.service";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const result = await runActiveSites(typeof body.name === "string" ? body.name : undefined, user.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}

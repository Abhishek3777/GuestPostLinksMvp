import { NextResponse } from "next/server";
import { removeSite, setSiteActive } from "@/services/sites.service";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { active?: boolean };
  if (typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
  await setSiteActive(id, body.active);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeSite(id);
  return NextResponse.json({ ok: true });
}

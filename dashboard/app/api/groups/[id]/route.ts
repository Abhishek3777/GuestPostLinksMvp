import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteGroup, setGroupDedupDays } from "@/services/groups.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  await deleteGroup(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { dedupDays?: number };
  const dedupDays = Number(body.dedupDays);
  if (!Number.isInteger(dedupDays) || dedupDays < 0) {
    return NextResponse.json({ error: "dedupDays must be a non-negative whole number" }, { status: 400 });
  }

  await setGroupDedupDays(id, dedupDays);
  return NextResponse.json({ ok: true });
}

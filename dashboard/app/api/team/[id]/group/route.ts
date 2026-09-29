import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { setMemberGroup } from "@/services/groups.service";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : null;

  await setMemberGroup(id, groupId);
  return NextResponse.json({ ok: true });
}

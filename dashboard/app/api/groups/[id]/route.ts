import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteGroup } from "@/services/groups.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  await deleteGroup(id);
  return NextResponse.json({ ok: true });
}

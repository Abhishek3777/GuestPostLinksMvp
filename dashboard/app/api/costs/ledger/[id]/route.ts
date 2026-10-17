import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteLedgerEntry } from "@/services/costs.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  await deleteLedgerEntry(id);
  return NextResponse.json({ ok: true });
}

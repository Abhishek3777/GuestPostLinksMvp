import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createGroup, listGroups } from "@/services/groups.service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  return NextResponse.json(await listGroups());
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Group name is required" }, { status: 400 });
  const dedupDays = Number(body.dedupDays);

  const id = await createGroup(name, Number.isInteger(dedupDays) && dedupDays >= 0 ? dedupDays : undefined);
  return NextResponse.json({ id });
}

import { NextResponse } from "next/server";
import { setSitePriority } from "@/services/analytics.service";
import { getCurrentUser } from "@/lib/auth";

// Admin-only: mark/unmark a site as part of the curated "priority" list.
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { id?: string; isPriority?: boolean };
  if (!body.id || typeof body.isPriority !== "boolean") {
    return NextResponse.json({ error: "id and isPriority are required" }, { status: 400 });
  }
  await setSitePriority(body.id, body.isPriority, user);
  return NextResponse.json({ ok: true });
}

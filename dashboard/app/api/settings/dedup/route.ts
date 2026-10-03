import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { setDedupDays } from "@/services/settings.service";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { dedupDays?: number };
  const dedupDays = Number(body.dedupDays);
  if (!Number.isInteger(dedupDays) || dedupDays < 0) {
    return NextResponse.json({ error: "dedupDays must be a non-negative whole number" }, { status: 400 });
  }

  await setDedupDays(dedupDays);
  return NextResponse.json({ ok: true });
}

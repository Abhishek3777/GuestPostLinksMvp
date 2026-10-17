import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { collectCosts, isCollecting } from "@/services/costCollector.service";

// Kicks off a collection in the background and returns right away — the first
// run backfills ~35 days of Railway usage and takes a minute or two.
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const already = isCollecting();
  void collectCosts();
  return NextResponse.json({ started: !already, collecting: true }, { status: 202 });
}

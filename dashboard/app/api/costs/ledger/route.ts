import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addLedgerEntry, PREPAID } from "@/services/costs.service";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { service?: string; date?: string; amount?: number; note?: string };
  const amount = Number(b.amount);
  if (!b.service || !(PREPAID as readonly string[]).includes(b.service))
    return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });

  await addLedgerEntry({ service: b.service, date: b.date, amount, note: (b.note ?? "").slice(0, 200) });
  return NextResponse.json({ ok: true });
}

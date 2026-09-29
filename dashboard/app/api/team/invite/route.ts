import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { inviteTeamMember } from "@/services/team.service";
import { getOrigin } from "@/lib/origin";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
  if (!email || !role) {
    return NextResponse.json({ error: "Email and a role are required" }, { status: 400 });
  }

  const result = await inviteTeamMember(email, role, getOrigin(req));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

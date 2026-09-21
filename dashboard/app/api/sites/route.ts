import { NextResponse } from "next/server";
import { parseDomainsCsv, parseDomainsText } from "@/lib/csv";
import { addSites, setSitesActive, type SiteFilter } from "@/services/sites.service";

// Add sites: pasted text and/or an uploaded .csv/.txt (same loose formats as a
// campaign upload). Existing sites are left exactly as they are.
export async function POST(req: Request) {
  const formData = await req.formData();
  const text = String(formData.get("domainsText") ?? "").trim();
  const file = formData.get("domainsFile") as File | null;

  const domains = [
    ...(file ? parseDomainsCsv(await file.text()) : []),
    ...(text ? parseDomainsText(text) : []),
  ];
  if (!domains.length) return NextResponse.json({ error: "Add at least one domain" }, { status: 400 });

  return NextResponse.json(await addSites(domains));
}

// Bulk activate / pause. Scoped to the list's current search and filter, so
// "pause all" on a filtered view only touches what that view shows.
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { active?: boolean; q?: string; filter?: string };
  if (typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
  const filter: SiteFilter = body.filter === "active" || body.filter === "paused" ? body.filter : "all";
  const updated = await setSitesActive(body.active, { q: body.q?.trim() || undefined, filter });
  return NextResponse.json({ updated });
}

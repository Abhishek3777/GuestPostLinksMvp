import { NextResponse } from "next/server";
import { domainsFromText, readDomainsFromFile, UnreadableFileError } from "@/lib/domainFile";
import { addSites, setSitesActive, type SiteFilter } from "@/services/sites.service";

// Add sites: pasted text and/or an uploaded .csv/.txt/.xlsx (same formats as a
// campaign upload). Existing sites are left exactly as they are.
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const text = String(formData.get("domainsText") ?? "").trim();
    const file = formData.get("domainsFile") as File | null;

    const domains = [...(file ? await readDomainsFromFile(file) : []), ...(text ? domainsFromText(text) : [])];
    if (!domains.length) return NextResponse.json({ error: "No valid domains found. Add one per row." }, { status: 400 });

    return NextResponse.json(await addSites(domains));
  } catch (err) {
    if (err instanceof UnreadableFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[api/sites] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Nothing was added." }, { status: 500 });
  }
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

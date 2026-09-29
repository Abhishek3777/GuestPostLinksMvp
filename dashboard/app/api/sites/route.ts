import { NextResponse } from "next/server";
import { domainsFromText, readDomainsFromFile, UnreadableFileError } from "@/lib/domainFile";
import {
  addSites,
  listActiveSiteDomains,
  removeSitesByIds,
  setSitesActive,
  setSitesActiveByIds,
  type SiteFilter,
} from "@/services/sites.service";

// The active-sites list, for the New Campaign page's "pull in the monitor
// list" option.
export async function GET() {
  return NextResponse.json({ domains: await listActiveSiteDomains() });
}

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

// Bulk activate / pause — either an explicit set of checked rows (`ids`), or
// (unchanged) everything the list's current search + filter shows.
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { active?: boolean; q?: string; filter?: string; ids?: string[] };
  if (typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 });

  if (Array.isArray(body.ids)) {
    const updated = await setSitesActiveByIds(body.ids, body.active);
    return NextResponse.json({ updated });
  }

  const filter: SiteFilter = body.filter === "active" || body.filter === "paused" ? body.filter : "all";
  const updated = await setSitesActive(body.active, { q: body.q?.trim() || undefined, filter });
  return NextResponse.json({ updated });
}

// Bulk delete an explicit set of checked rows.
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids) || !body.ids.length) return NextResponse.json({ error: "ids is required" }, { status: 400 });
  const deleted = await removeSitesByIds(body.ids);
  return NextResponse.json({ deleted });
}

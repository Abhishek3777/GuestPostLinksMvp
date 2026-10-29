import { NextResponse } from "next/server";
import { domainsFromText, readDomainsFromFile, UnreadableFileError } from "@/lib/domainFile";
import {
  addSites,
  listActiveSiteDomains,
  removeSitesByIds,
  setSitesActive,
  setSitesActiveByIds,
  type OwnerFilter,
  type SiteFilter,
} from "@/services/sites.service";
import { getCurrentUser } from "@/lib/auth";

// The active-sites list, for the New Campaign page's "pull in the monitor
// list" option — always just the signed-in user's own.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ domains: await listActiveSiteDomains(user) });
}

// Add sites: pasted text and/or an uploaded .csv/.txt/.xlsx (same formats as a
// campaign upload). Existing sites are left exactly as they are.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const formData = await req.formData();
    const text = String(formData.get("domainsText") ?? "").trim();
    const file = formData.get("domainsFile") as File | null;
    // Admin only: upload straight onto someone else's list instead of their
    // own. Silently ignored for a non-admin so a crafted request can't assign
    // sites to another member.
    const assignTo = String(formData.get("assignTo") ?? "").trim();
    const createdBy = user.role === "admin" && assignTo ? assignTo : user.id;

    const domains = [...(file ? await readDomainsFromFile(file) : []), ...(text ? domainsFromText(text) : [])];
    if (!domains.length) return NextResponse.json({ error: "No valid domains found. Add one per row." }, { status: 400 });

    return NextResponse.json(await addSites(domains, createdBy));
  } catch (err) {
    if (err instanceof UnreadableFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[api/sites] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Nothing was added." }, { status: 500 });
  }
}

// Bulk activate / pause — either an explicit set of checked rows (`ids`), or
// (unchanged) everything the list's current search + filter shows. Scoped to
// the signed-in user's own sites unless they're an admin.
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    active?: boolean;
    q?: string;
    filter?: string;
    ids?: string[];
    ownerId?: string;
  };
  if (typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 });

  if (Array.isArray(body.ids)) {
    const updated = await setSitesActiveByIds(body.ids, body.active, user);
    return NextResponse.json({ updated });
  }

  const filter: SiteFilter = body.filter === "active" || body.filter === "paused" ? body.filter : "all";
  const ownerId: OwnerFilter = body.ownerId;
  const updated = await setSitesActive(body.active, user, { q: body.q?.trim() || undefined, filter, ownerId });
  return NextResponse.json({ updated });
}

// Bulk delete an explicit set of checked rows.
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids) || !body.ids.length) return NextResponse.json({ error: "ids is required" }, { status: 400 });
  const deleted = await removeSitesByIds(body.ids, user);
  return NextResponse.json({ deleted });
}

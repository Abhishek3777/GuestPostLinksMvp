import { NextResponse } from "next/server";
import { reassignSites, reassignSitesByIds, type OwnerFilter, type SiteFilter } from "@/services/sites.service";
import { getCurrentUser } from "@/lib/auth";

// Admin-only: hand ownership of sites to a different member — either an
// explicit set of checked rows (`ids`), or everything the current
// search/filter/owner view shows (the "reassign ALL of X's sites" case).
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    newOwnerId?: string;
    q?: string;
    filter?: string;
    ids?: string[];
    ownerId?: string;
  };
  if (!body.newOwnerId) return NextResponse.json({ error: "newOwnerId is required" }, { status: 400 });

  if (Array.isArray(body.ids)) {
    const updated = await reassignSitesByIds(body.ids, body.newOwnerId, user);
    return NextResponse.json({ updated });
  }

  const filter: SiteFilter = body.filter === "active" || body.filter === "paused" ? body.filter : "all";
  const ownerId: OwnerFilter = body.ownerId;
  const updated = await reassignSites(body.newOwnerId, user, { q: body.q?.trim() || undefined, filter, ownerId });
  return NextResponse.json({ updated });
}

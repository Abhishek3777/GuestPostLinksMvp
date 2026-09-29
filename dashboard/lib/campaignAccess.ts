import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "./db";
import { campaigns } from "./schema";
import { getCurrentUser, type CurrentUser } from "./auth";

// Admin: every campaign. Everyone else: only the ones they started. Returns a
// bool rather than throwing so callers pick the right response — notFound()
// for a page, 403 for an API route.
export async function canAccessCampaign(campaignId: string, user: CurrentUser): Promise<boolean> {
  if (user.role === "admin") return true;
  const [c] = await db.select({ createdBy: campaigns.createdBy }).from(campaigns).where(eq(campaigns.id, campaignId));
  return !!c && c.createdBy === user.id;
}

// Shared guard for the campaign mutation/export routes: signed in, and either
// admin or the campaign's owner. Returns the user on success, or the
// NextResponse to return immediately on failure.
export async function requireCampaignAccess(
  campaignId: string
): Promise<{ user: CurrentUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!(await canAccessCampaign(campaignId, user))) {
    return { response: NextResponse.json({ error: "Campaign not found" }, { status: 404 }) };
  }
  return { user };
}

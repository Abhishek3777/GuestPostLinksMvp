import { NextResponse } from "next/server";
import {
  buildCampaignTable,
  buildProspectsTable,
  buildTableCsv,
  selectColumns,
  type CampaignTable,
} from "@/lib/campaignCsv";
import { buildCampaignXlsx } from "@/lib/campaignXlsx";
import { getCampaignDetail } from "@/services/campaigns.service";
import { requireCampaignAccess } from "@/lib/campaignAccess";

// The column sets live in lib/campaignCsv.ts and nowhere else. This route only
// fetches data and hands it over.
//
// Full-pipeline campaigns export the usual 17 columns, grouped by input domain:
// every domain you sent appears once and every backlink domain appears once.
// Contact Lookup campaigns are already one row per domain.
//
//   ?format=xlsx           Excel with the important columns highlighted (default: CSV)
//   ?cols=A,B,C            keep only these columns (default: all of them)
//   ?ignoreGroupDedup=true testing only — see the note below
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCampaignAccess(id);
  if ("response" in access) return access.response;

  const detail = await getCampaignDetail(id);
  if (!detail) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const { campaign } = detail;
  const query = new URL(req.url).searchParams;

  // Testing aid for the group-dedup feature: shows the campaign as if its
  // teammate-claimed leads had never been excluded, so you can compare this
  // against the normal export and see exactly which rows the dedup removed.
  // These rows never went through Stage 3 (contact lookup was skipped for
  // them, same as any other excluded prospect), so their contact columns are
  // still blank here — this reveals the LEAD list the dedup affected, not
  // contact info that was never looked up.
  const ignoreGroupDedup = query.get("ignoreGroupDedup") === "true";
  const prospects = ignoreGroupDedup
    ? detail.prospects.map((p) => (p.exclusionReason === "claimed_by_teammate" ? { ...p, exclusionReason: null } : p))
    : detail.prospects;

  const input = {
    mode: campaign.mode,
    contactStageStatus: campaign.contactStageStatus,
    domains: detail.domains,
    crawl: detail.domainStatuses,
    links: detail.links,
    prospects,
  };

  const cols = query.get("cols")?.split(",").filter(Boolean);
  const pick = (table: CampaignTable) => (cols?.length ? selectColumns(table, cols) : null) ?? table;

  const table = pick(campaign.mode === "discovery" ? buildProspectsTable(input) : buildCampaignTable(input));

  const safeName = campaign.name.replace(/[^a-z0-9-]+/gi, "_");
  const suffix = (campaign.mode === "direct" ? "contact-lookup" : "full-pipeline") + (ignoreGroupDedup ? "_no-dedup" : "");

  if (query.get("format") === "xlsx") {
    const xlsx = await buildCampaignXlsx([{ name: "Prospects", table }]);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}_${suffix}.xlsx"`,
      },
    });
  }

  return new NextResponse(buildTableCsv(table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}_${suffix}.csv"`,
    },
  });
}

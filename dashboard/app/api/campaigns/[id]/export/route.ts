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

// The column sets live in lib/campaignCsv.ts and nowhere else. This route only
// fetches data and hands it over.
//
// Full-pipeline campaigns export the usual 17 columns, grouped by input domain:
// every domain you sent appears once and every backlink domain appears once.
// Contact Lookup campaigns are already one row per domain.
//
//   ?format=xlsx   Excel with the important columns highlighted (default: CSV)
//   ?cols=A,B,C    keep only these columns (default: all of them)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCampaignDetail(id);
  if (!detail) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const { campaign } = detail;
  const input = {
    mode: campaign.mode,
    contactStageStatus: campaign.contactStageStatus,
    domains: detail.domains,
    crawl: detail.domainStatuses,
    links: detail.links,
    prospects: detail.prospects,
  };

  const query = new URL(req.url).searchParams;
  const cols = query.get("cols")?.split(",").filter(Boolean);
  const pick = (table: CampaignTable) => (cols?.length ? selectColumns(table, cols) : null) ?? table;

  const table = pick(campaign.mode === "discovery" ? buildProspectsTable(input) : buildCampaignTable(input));

  const safeName = campaign.name.replace(/[^a-z0-9-]+/gi, "_");
  const suffix = campaign.mode === "direct" ? "contact-lookup" : "full-pipeline";

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

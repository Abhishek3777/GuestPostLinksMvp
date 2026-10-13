import { NextResponse } from "next/server";
import {
  buildCampaignTable,
  buildNoBacklinksTable,
  buildProspectsTable,
  buildTableCsv,
  selectColumns,
  type CampaignTable,
} from "@/lib/campaignCsv";
import { buildCampaignXlsx } from "@/lib/campaignXlsx";
import { getCampaignExportData } from "@/services/campaigns.service";
import { requireCampaignAccess } from "@/lib/campaignAccess";

// The column sets live in lib/campaignCsv.ts and nowhere else. This route only
// fetches data and hands it over.
//
// Full-pipeline campaigns export the usual 17 columns, one row per unique
// backlink domain (an input domain that found 800 distinct backlinks produces
// 800 rows, Input Domain repeated down the column). Contact Lookup campaigns
// are already one row per domain.
//
//   ?format=xlsx           Excel (plain cells, clickable links) (default: CSV)
//   ?cols=A,B,C            keep only these columns (default: all of them)
//   ?ignoreGroupDedup=true testing only — see the note below
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCampaignAccess(id);
  if ("response" in access) return access.response;

  const detail = await getCampaignExportData(id);
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
  // The Excluded sheet is pointless without its reason column, regardless of
  // whichever columns were picked for the main export — force it in. Contact
  // Notes is forced in too: for a "redirected" row, the reason alone is just
  // the word "redirected" — the actual from -> to detail lives in this
  // column, not in Prospect Decision (confirmed missing from a real export,
  // 2026-10-13: a custom column pick had dropped it, leaving the Excluded
  // sheet with no way to tell WHERE a redirected domain actually went).
  const excludedCols = cols?.length ? [...new Set([...cols, "Prospect Decision", "Contact Notes"])] : undefined;
  const pickExcluded = (table: CampaignTable) => (excludedCols?.length ? selectColumns(table, excludedCols) : null) ?? table;
  // Same idea for No Backlinks Found — "why" (crawl status / contact status)
  // is the whole point of that sheet, so it stays even if not explicitly picked.
  const incompleteCols = cols?.length ? [...new Set([...cols, "Status", "Reason / Notes", "Contact Status"])] : undefined;
  const pickIncomplete = (table: CampaignTable) => (incompleteCols?.length ? selectColumns(table, incompleteCols) : null) ?? table;

  const safeName = campaign.name.replace(/[^a-z0-9-]+/gi, "_");
  const suffix = (campaign.mode === "direct" ? "contact-lookup" : "full-pipeline") + (ignoreGroupDedup ? "_no-dedup" : "");

  if (query.get("format") === "xlsx") {
    // Full pipeline gets three tabs — Contacts (a real email or contact form
    // was found, full stop), Excluded (a business rule says don't pursue it),
    // and No Contact Info (everything else: no backlink at all, or a backlink
    // that's kept but came back with nothing to reach out with yet). Matches
    // the reference file this was built against, where every single Contacts
    // row has real data in every column — no half-finished rows mixed in.
    const sheets =
      campaign.mode === "discovery"
        ? [
            { name: "Contacts", table: pick(buildProspectsTable(input, "kept")) },
            { name: "Excluded", table: pickExcluded(buildProspectsTable(input, "excluded")) },
            { name: "No Contact Info", table: pickIncomplete(buildNoBacklinksTable(input)) },
          ]
        : [{ name: "Contacts", table: pick(buildCampaignTable(input)) }];

    const xlsx = await buildCampaignXlsx(sheets);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}_${suffix}.xlsx"`,
      },
    });
  }

  // CSV has no tabs, so kept and excluded stay together in one file — the
  // Prospect Decision column is what distinguishes them there.
  const table = pick(campaign.mode === "discovery" ? buildProspectsTable(input) : buildCampaignTable(input));
  return new NextResponse(buildTableCsv(table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}_${suffix}.csv"`,
    },
  });
}

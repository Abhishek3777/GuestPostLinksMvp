import ExcelJS from "exceljs";
import type { CampaignTable } from "./campaignCsv";

// Same rows and columns as the CSV export (lib/campaignCsv.ts) — this only adds
// what a CSV can't carry: sized columns, a frozen header row and a filter. No
// fill colors or bold — plain cells throughout, on request. URLs/emails are
// plain text, not clickable hyperlinks — Excel hard-caps a worksheet at 65,530
// hyperlinks, and a full-pipeline Contacts sheet (one row per real backlink,
// several link-shaped columns each) clears that easily once a campaign has a
// few thousand genuine leads. Going over it is exactly what produced the
// "we found a problem with some content" corruption dialog on a 20k+ row
// export — plain text has no such ceiling at any campaign size.

export interface XlsxSheet {
  name: string;
  table: CampaignTable;
}

export async function buildCampaignXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const { name, table } of sheets) addSheet(workbook, name, table);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addSheet(workbook: ExcelJS.Workbook, sheetName: string, table: CampaignTable) {
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });

  sheet.addRow([...table.columns]);
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 22;

  const widths = table.columns.map((c) => c.length + 2);

  for (const values of table.rows) {
    const row = sheet.addRow([]);
    for (let i = 0; i < table.columns.length; i++) {
      const raw = values[i];
      const text = raw === null || raw === undefined ? "" : String(raw);
      const cell = row.getCell(i + 1);

      cell.value = typeof raw === "number" ? raw : text;
      cell.alignment = { vertical: "top", wrapText: true };
      const longestLine = Math.max(...text.split("\n").map((l) => l.length));
      widths[i] = Math.min(60, Math.max(widths[i], longestLine + 2));
    }
  }

  // Columns that describe a whole group of rows (an input domain and its crawl
  // result) are merged down the group, so each appears once.
  if (table.groups) {
    const groupColumns = table.columns
      .map((c, i) => (table.groups!.columns.includes(c) ? i + 1 : 0))
      .filter((n) => n > 0);
    let top = 2; // row 1 is the header
    for (const size of table.groups.sizes) {
      if (size > 1) for (const col of groupColumns) sheet.mergeCells(top, col, top + size - 1, col);
      top += size;
    }
  }

  sheet.columns.forEach((col, i) => {
    col.width = widths[i];
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };
}

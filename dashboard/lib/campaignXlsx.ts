import ExcelJS from "exceljs";
import type { CampaignTable } from "./campaignCsv";

// Same rows and columns as the CSV export (lib/campaignCsv.ts) — this only adds
// the formatting a CSV can't carry: the columns a reader cares about most
// (real domains, guest post URLs, emails, contact forms) are highlighted, and
// their links are clickable.

const HEADER_FILL = "FF1F2937";
const HEADER_TEXT = "FFFFFFFF";
const HIGHLIGHT_HEADER_FILL = "FFFFC000";
const HIGHLIGHT_HEADER_TEXT = "FF000000";
const HIGHLIGHT_CELL_FILL = "FFFFF2CC";

// Excel refuses hyperlinks past 2079 characters.
const MAX_LINK_LENGTH = 2000;

function linkFor(column: string, value: string): string | null {
  if (value.length > MAX_LINK_LENGTH) return null;
  if (column === "Email") return value.includes("@") ? `mailto:${value.split(/[;,\s]+/)[0]}` : null;
  if (column.endsWith("URL") && /^https?:\/\//i.test(value)) return value;
  return null;
}

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

  const highlighted = new Set(table.highlight);
  sheet.addRow([...table.columns]);

  table.columns.forEach((column, i) => {
    const cell = sheet.getRow(1).getCell(i + 1);
    const isHighlight = highlighted.has(column);
    cell.font = { bold: true, color: { argb: isHighlight ? HIGHLIGHT_HEADER_TEXT : HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isHighlight ? HIGHLIGHT_HEADER_FILL : HEADER_FILL } };
    cell.alignment = { vertical: "middle" };
  });
  sheet.getRow(1).height = 22;

  const widths = table.columns.map((c) => c.length + 2);

  for (const values of table.rows) {
    const row = sheet.addRow([]);
    table.columns.forEach((column, i) => {
      const raw = values[i];
      const text = raw === null || raw === undefined ? "" : String(raw);
      const cell = row.getCell(i + 1);

      // A cell holding several values (one per line) can't be a single link.
      const link = text && !text.includes("\n") ? linkFor(column, text) : null;
      cell.value = link ? { text, hyperlink: link } : typeof raw === "number" ? raw : text;

      if (text && highlighted.has(column)) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT_CELL_FILL } };
        cell.font = link ? { bold: true, underline: true, color: { argb: "FF0563C1" } } : { bold: true };
      } else if (link) {
        cell.font = { underline: true, color: { argb: "FF0563C1" } };
      }

      cell.alignment = { vertical: "top", wrapText: true };
      const longestLine = Math.max(...text.split("\n").map((l) => l.length));
      widths[i] = Math.min(60, Math.max(widths[i], longestLine + 2));
    });
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

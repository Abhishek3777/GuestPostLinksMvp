import ExcelJS from "exceljs";
import { parseDomainsCsv, parseDomainsText } from "./csv";

// Turns whatever the user uploads into a clean list of domains — or refuses it
// with a message a person can act on. Before this, an Excel file was read as if
// it were text: the binary junk was saved as "domains", the database rejected it,
// and the user was left with an empty campaign marked "completed".

export class UnreadableFileError extends Error {}

const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// Keeps only things that look like a domain. This also drops a "domain" / "Website"
// header row and any stray text, so it can never reach the database.
export function keepValidDomains(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const d = raw.trim().toLowerCase();
    if (d.length > 253 || !DOMAIN_SHAPE.test(d)) continue;
    // The ending must be a real name (com, co.uk, xn--p1ai), not digits: a stray
    // number in a cell would otherwise become an IP-looking "domain" like 0.0.48.57.
    const tld = d.slice(d.lastIndexOf(".") + 1);
    if (!/^[a-z]{2,}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) continue;
    out.add(d);
  }
  return [...out];
}

export function domainsFromText(text: string): string[] {
  return keepValidDomains(parseDomainsText(text));
}

// A cell can hold plain text, a number, a hyperlink object or rich text.
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return "";
  if ("text" in value && typeof value.text === "string") return value.text; // hyperlink
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
  return "";
}

export async function readDomainsFromFile(file: File): Promise<string[]> {
  const buf = Buffer.from(await file.arrayBuffer());
  const isZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" — every .xlsx starts this way

  if (isZip || /\.xlsx?$/i.test(file.name)) {
    if (!isZip) {
      throw new UnreadableFileError("Old .xls files can't be read. Open it in Excel and save it as .xlsx or .csv, then upload again.");
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new UnreadableFileError("That Excel file couldn't be opened. Save it again as .xlsx or .csv and retry.");
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new UnreadableFileError("That Excel file has no sheets.");

    // First column of the first sheet, one domain per row.
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const text = cellText(row.getCell(1).value).trim();
      if (text) lines.push(text);
    });
    return keepValidDomains(parseDomainsCsv(lines.join("\n")));
  }

  // Plain text/CSV. A NUL byte means it is really a binary file with the wrong extension.
  if (buf.includes(0)) {
    throw new UnreadableFileError("That file isn't a text or Excel file. Upload a .csv, .txt or .xlsx with one domain per row.");
  }
  return keepValidDomains(parseDomainsCsv(buf.toString("utf8")));
}

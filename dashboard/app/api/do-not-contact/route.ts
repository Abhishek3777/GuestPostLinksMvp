import { NextResponse } from "next/server";
import { domainsFromText, readDomainsFromFile, UnreadableFileError } from "@/lib/domainFile";
import { addDoNotContactDomains, removeDoNotContactByIds } from "@/services/doNotContact.service";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("domainsFile") as File | null;
    const text = String(formData.get("domainsText") ?? "").trim();
    if (!file && !text) return NextResponse.json({ error: "Type a domain or upload a CSV, TXT or Excel file" }, { status: 400 });

    const fromFile = file ? await readDomainsFromFile(file) : [];
    const fromText = text ? domainsFromText(text) : [];
    const domains = [...new Set([...fromFile, ...fromText])];
    if (domains.length === 0) {
      return NextResponse.json({ error: "No valid domains were found." }, { status: 400 });
    }
    const added = await addDoNotContactDomains(domains);

    return NextResponse.json({ added });
  } catch (err) {
    if (err instanceof UnreadableFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[api/do-not-contact] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Nothing was added." }, { status: 500 });
  }
}

// Bulk delete an explicit set of checked rows.
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids) || !body.ids.length) return NextResponse.json({ error: "ids is required" }, { status: 400 });
  const deleted = await removeDoNotContactByIds(body.ids);
  return NextResponse.json({ deleted });
}

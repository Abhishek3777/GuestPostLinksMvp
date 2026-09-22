import { NextResponse } from "next/server";
import { readDomainsFromFile, UnreadableFileError } from "@/lib/domainFile";
import { addDoNotContactDomains } from "@/services/doNotContact.service";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("domainsFile") as File | null;
    if (!file) return NextResponse.json({ error: "A CSV, TXT or Excel file is required" }, { status: 400 });

    const domains = await readDomainsFromFile(file);
    if (domains.length === 0) {
      return NextResponse.json({ error: "No valid domains were found in that file." }, { status: 400 });
    }
    const added = await addDoNotContactDomains(domains);

    return NextResponse.json({ added });
  } catch (err) {
    if (err instanceof UnreadableFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[api/do-not-contact] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Nothing was added." }, { status: 500 });
  }
}

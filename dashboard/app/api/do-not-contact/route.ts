import { NextResponse } from "next/server";
import { parseDomainsCsv } from "@/lib/csv";
import { addDoNotContactDomains } from "@/services/doNotContact.service";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("domainsFile") as File | null;
  if (!file) return NextResponse.json({ error: "A CSV file is required" }, { status: 400 });

  const text = await file.text();
  const domains = parseDomainsCsv(text);
  const added = await addDoNotContactDomains(domains);

  return NextResponse.json({ added });
}

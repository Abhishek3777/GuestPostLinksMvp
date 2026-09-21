import { NextResponse } from "next/server";
import { parseDomainsCsv, parseDomainsText } from "@/lib/csv";
import { createCampaign } from "@/services/campaigns.service";

export async function POST(req: Request) {
  const formData = await req.formData();

  const name = String(formData.get("name") ?? "").trim();
  const modeRaw = String(formData.get("mode") ?? "discovery").trim();
  const daysWindowRaw = String(formData.get("daysWindow") ?? "").trim();
  const targetPostCountRaw = String(formData.get("targetPostCount") ?? "").trim();
  const file = formData.get("domainsFile") as File | null;
  const domainsText = String(formData.get("domainsText") ?? "").trim();

  if (!name) return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  if (!file && !domainsText) {
    return NextResponse.json({ error: "Add domains or upload a domains file" }, { status: 400 });
  }

  const mode = modeRaw === "direct" ? "direct" : "discovery";
  const targetPostCount = Number(targetPostCountRaw) || 5;
  const daysWindow = daysWindowRaw ? Number(daysWindowRaw) : undefined;

  const fromFile = file ? parseDomainsCsv(await file.text()) : [];
  const fromText = domainsText ? parseDomainsText(domainsText) : [];
  const domains = [...new Set([...fromFile, ...fromText])];

  if (domains.length === 0) {
    return NextResponse.json({ error: "No valid domains found in the input" }, { status: 400 });
  }

  // Checkbox: present ("on") when ticked, absent when not. Only meaningful
  // for the full pipeline — Contact Lookup always goes straight to contacts.
  const autoContact = formData.get("autoContact") === "on";

  const campaignId = await createCampaign({ name, mode, autoContact, daysWindow, targetPostCount, domains });

  return NextResponse.json({ campaignId });
}

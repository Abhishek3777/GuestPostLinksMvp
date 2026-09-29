import { NextResponse } from "next/server";
import { domainsFromText, readDomainsFromFile, UnreadableFileError } from "@/lib/domainFile";
import { createCampaign } from "@/services/campaigns.service";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

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

    // Read and validate the domains BEFORE creating anything, so a bad file can
    // never leave an empty campaign behind.
    const fromFile = file ? await readDomainsFromFile(file) : [];
    const fromText = domainsText ? domainsFromText(domainsText) : [];
    const domains = [...new Set([...fromFile, ...fromText])];

    if (domains.length === 0) {
      return NextResponse.json(
        { error: "No valid domains were found. Use one domain per row (example.com) in a .csv, .txt or .xlsx file, or paste them in." },
        { status: 400 }
      );
    }

    // Checkbox: present ("on") when ticked, absent when not. Only meaningful
    // for the full pipeline — Contact Lookup always goes straight to contacts.
    const autoContact = formData.get("autoContact") === "on";

    const campaignId = await createCampaign({ name, mode, autoContact, daysWindow, targetPostCount, domains, createdBy: user.id });

    return NextResponse.json({ campaignId, domainCount: domains.length });
  } catch (err) {
    if (err instanceof UnreadableFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[api/campaigns] failed:", err);
    // Always JSON, so the page can show it instead of hanging on "Starting…".
    return NextResponse.json({ error: "Something went wrong creating the campaign. Nothing was started." }, { status: 500 });
  }
}

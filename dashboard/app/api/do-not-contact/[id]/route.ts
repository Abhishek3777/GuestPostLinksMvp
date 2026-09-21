import { NextResponse } from "next/server";
import { removeDoNotContact } from "@/services/doNotContact.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeDoNotContact(id);
  return NextResponse.json({ ok: true });
}

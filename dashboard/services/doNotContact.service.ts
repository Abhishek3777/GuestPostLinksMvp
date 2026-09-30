import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { doNotContact } from "@/lib/schema";

export async function listDoNotContact() {
  return db.select().from(doNotContact).orderBy(desc(doNotContact.addedAt));
}

// Additive only, by design — uploading a CSV merges new domains into the
// existing list (duplicates silently skipped via onConflictDoNothing), it
// never clears what's already there. This is a suppression list; a re-upload
// accidentally wiping past opt-outs would be a compliance problem, not a
// data one, so "replace" was deliberately never built as an option here.
export async function addDoNotContactDomains(domains: string[]) {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return 0;
  await db
    .insert(doNotContact)
    .values(unique.map((domain) => ({ domain })))
    .onConflictDoNothing();
  return unique.length;
}

export async function removeDoNotContact(id: string) {
  await db.delete(doNotContact).where(eq(doNotContact.id, id));
}

export async function removeDoNotContactByIds(ids: string[]) {
  if (!ids.length) return 0;
  const deleted = await db.delete(doNotContact).where(inArray(doNotContact.id, ids)).returning({ id: doNotContact.id });
  return deleted.length;
}

import { count, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { doNotContact } from "@/lib/schema";

export const DNC_PAGE_SIZE = 50;

// Paginated + searchable, same reason Sites to monitor is: this list can run
// into six figures (bulk opt-out uploads), and rendering every row at once in
// a single unpaginated table would be its own problem even after the insert
// side was fixed to handle that volume.
export async function listDoNotContact(opts: { q?: string; page?: number } = {}) {
  const { q } = opts;
  const page = Math.max(1, opts.page ?? 1);
  const where = q ? ilike(doNotContact.domain, `%${q}%`) : undefined;

  const [entries, [{ total }]] = await Promise.all([
    db
      .select()
      .from(doNotContact)
      .where(where)
      .orderBy(desc(doNotContact.addedAt))
      .limit(DNC_PAGE_SIZE)
      .offset((page - 1) * DNC_PAGE_SIZE),
    db.select({ total: count() }).from(doNotContact).where(where),
  ]);

  return { entries, total, pageCount: Math.max(1, Math.ceil(total / DNC_PAGE_SIZE)) };
}

// Additive only, by design — uploading a CSV merges new domains into the
// existing list (duplicates silently skipped via onConflictDoNothing), it
// never clears what's already there. This is a suppression list; a re-upload
// accidentally wiping past opt-outs would be a compliance problem, not a
// data one, so "replace" was deliberately never built as an option here.
// Postgres caps a single query at 65535 bound parameters — one per row here,
// since only `domain` is bound. A 120k-row upload blows straight through that
// in one insert, so it goes in chunks well under the limit instead.
const INSERT_CHUNK_SIZE = 5000;

export async function addDoNotContactDomains(domains: string[]) {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return 0;
  for (let i = 0; i < unique.length; i += INSERT_CHUNK_SIZE) {
    await db
      .insert(doNotContact)
      .values(unique.slice(i, i + INSERT_CHUNK_SIZE).map((domain) => ({ domain })))
      .onConflictDoNothing();
  }
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

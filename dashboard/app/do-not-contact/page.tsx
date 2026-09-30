import { ShieldOff } from "lucide-react";
import Link from "next/link";
import { DNC_PAGE_SIZE, listDoNotContact } from "@/services/doNotContact.service";
import { DncUploadForm } from "@/components/DncUploadForm";
import { DncTable } from "@/components/DncTable";
import { DncSearch } from "@/components/DncSearch";

export const dynamic = "force-dynamic";

export default async function DoNotContactPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { entries, total, pageCount } = await listDoNotContact({ q: q.trim() || undefined, page });

  function pageHref(target: number) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (target > 1) p.set("page", String(target));
    const qs = p.toString();
    return qs ? `/do-not-contact?${qs}` : "/do-not-contact";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Do Not Contact</h1>
        <p className="mt-1 text-sm text-muted">
          One shared list, used by every campaign&apos;s Stage 2 filter opt-outs, hostile replies, existing clients.
        </p>
      </div>

      <DncUploadForm />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DncSearch />
        <span className="text-xs text-muted">
          {total.toLocaleString()} domain{total === 1 ? "" : "s"}
          {q ? ` matching “${q}”` : ""}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning">
            <ShieldOff size={20} />
          </div>
          <p className="text-sm text-muted">{total === 0 ? "No domains on the list yet." : "No domains match this search."}</p>
        </div>
      ) : (
        <DncTable entries={entries} total={total} q={q.trim()} />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Page {page} of {pageCount} · {DNC_PAGE_SIZE} per page
          </span>
          <div className="flex gap-2">
            <Link
              href={pageHref(page - 1)}
              aria-disabled={page <= 1}
              className={`rounded-lg border border-border px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
            >
              Previous
            </Link>
            <Link
              href={pageHref(page + 1)}
              aria-disabled={page >= pageCount}
              className={`rounded-lg border border-border px-3 py-1.5 ${page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

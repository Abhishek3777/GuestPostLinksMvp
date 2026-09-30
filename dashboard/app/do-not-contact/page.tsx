import { ShieldOff } from "lucide-react";
import { listDoNotContact } from "@/services/doNotContact.service";
import { DncUploadForm } from "@/components/DncUploadForm";
import { DncTable } from "@/components/DncTable";

export const dynamic = "force-dynamic";

export default async function DoNotContactPage() {
  const entries = await listDoNotContact();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Do Not Contact</h1>
        <p className="mt-1 text-sm text-muted">
          One shared list, used by every campaign&apos;s Stage 2 filter opt-outs, hostile replies, existing clients.
        </p>
      </div>

      <DncUploadForm />

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning">
            <ShieldOff size={20} />
          </div>
          <p className="text-sm text-muted">No domains on the list yet.</p>
        </div>
      ) : (
        <DncTable entries={entries} />
      )}
    </div>
  );
}

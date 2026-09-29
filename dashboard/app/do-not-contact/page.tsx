import { ShieldOff } from "lucide-react";
import { listDoNotContact } from "@/services/doNotContact.service";
import { DncUploadForm } from "@/components/DncUploadForm";
import { DeleteDncButton } from "@/components/DeleteDncButton";

export const dynamic = "force-dynamic";

export default async function DoNotContactPage() {
  const entries = await listDoNotContact();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Do Not Contact</h1>
          <p className="mt-1 text-sm text-muted">
            One shared list, used by every campaign&apos;s Stage 2 filter opt-outs, hostile replies, existing clients.
          </p>
        </div>
        <DncUploadForm />
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning">
            <ShieldOff size={20} />
          </div>
          <p className="text-sm text-muted">No domains on the list yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-5 py-3">Domain</th>
                <th className="px-5 py-3">Added</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-5 py-3 font-medium text-text">{e.domain}</td>
                  <td className="px-5 py-3 text-muted">{new Date(e.addedAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right">
                    <DeleteDncButton id={e.id} domain={e.domain} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

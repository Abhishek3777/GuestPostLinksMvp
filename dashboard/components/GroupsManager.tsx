"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Users2 } from "lucide-react";

export interface GroupRow {
  id: string;
  name: string;
  dedupDays: number;
  memberCount: number;
}

export function GroupsManager({ groups }: { groups: GroupRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [dedupDays, setDedupDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, dedupDays: Number(dedupDays) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not create the group");
    setName("");
    setDedupDays("90");
    router.refresh();
  }

  async function remove(id: string, groupName: string) {
    if (!confirm(`Delete "${groupName}"? Its members keep their campaigns and results — they just won't be in a group anymore.`)) return;
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  async function updateDedupDays(id: string, days: string) {
    const value = Number(days);
    if (!Number.isInteger(value) || value < 0) return;
    await fetch(`/api/groups/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dedupDays: value }),
    });
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users2 size={16} className="text-muted" />
        <h2 className="text-sm font-semibold text-text">Groups</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        Members in the same group never work the same lead twice — whichever of them finds it first keeps it, and the rest see
        it excluded as &quot;claimed by teammate&quot; for that group&apos;s cooldown period. A lead is considered spoken for the
        moment it&apos;s kept, whether or not contact info was actually found yet — since that&apos;s exactly what would show up
        in an export.
      </p>

      <form onSubmit={create} className="mb-4 flex gap-2">
        <input
          type="text"
          required
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            required
            value={dedupDays}
            onChange={(e) => setDedupDays(e.target.value)}
            title="Cooldown, in days, before a claimed lead becomes available to the group again"
            className="w-20 rounded-lg border border-border bg-bg px-2 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="text-xs text-muted">days</span>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </form>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {groups.length === 0 ? (
        <p className="text-sm text-muted">No groups yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="font-medium text-text">
                {g.name} <span className="font-normal text-muted">· {g.memberCount} member{g.memberCount === 1 ? "" : "s"}</span>
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Re-contact after
                  <input
                    type="number"
                    min={0}
                    defaultValue={g.dedupDays}
                    onBlur={(e) => updateDedupDays(g.id, e.target.value)}
                    className="w-16 rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  days
                </label>
                <button onClick={() => remove(g.id, g.name)} className="text-muted hover:text-danger" title="Delete group">
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

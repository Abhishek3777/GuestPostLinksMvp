"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Users2 } from "lucide-react";

export interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
}

export function GroupsManager({ groups }: { groups: GroupRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not create the group");
    setName("");
    router.refresh();
  }

  async function remove(id: string, groupName: string) {
    if (!confirm(`Delete "${groupName}"? Its members keep their campaigns and results — they just won't be in a group anymore.`)) return;
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users2 size={16} className="text-muted" />
        <h2 className="text-sm font-semibold text-text">Groups</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        Members in the same group never work the same lead twice — whichever of them finds it first keeps it, the rest see it
        excluded as &quot;claimed by teammate&quot;.
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
              <button onClick={() => remove(g.id, g.name)} className="text-muted hover:text-danger" title="Delete group">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

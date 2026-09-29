"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MemberGroupSelect({
  profileId,
  currentGroupId,
  groups,
}: {
  profileId: string;
  currentGroupId: string | null;
  groups: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(e: React.ChangeEvent<HTMLSelectElement>) {
    setBusy(true);
    await fetch(`/api/team/${profileId}/group`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: e.target.value || null }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <select
      defaultValue={currentGroupId ?? ""}
      onChange={change}
      disabled={busy}
      className="rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
    >
      <option value="">No group</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

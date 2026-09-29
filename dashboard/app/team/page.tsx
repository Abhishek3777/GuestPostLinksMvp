import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listGroups, listTeamWithGroups } from "@/services/groups.service";
import { GroupsManager } from "@/components/GroupsManager";
import { MemberGroupSelect } from "@/components/MemberGroupSelect";
// Invite form is off for now — internal tool, accounts are seeded directly
// (dashboard/scripts/bootstrap-admin.mjs). Re-add when invites come back:
// import { InviteForm } from "@/components/InviteForm";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const [team, groups] = await Promise.all([listTeamWithGroups(), listGroups()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Team</h1>
        <p className="mt-1 text-sm text-muted">
          Admins see every campaign. Members only see the campaigns they started.
        </p>
      </div>

      <GroupsManager groups={groups} />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Group</th>
              <th className="px-5 py-3">Added</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3 font-medium text-text">{m.email}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      m.role === "admin" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {m.role}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {/* Admins see and act on every campaign regardless — a group
                      assignment on them would have no effect, so it's not offered. */}
                  {m.role === "admin" ? (
                    <span className="text-xs text-muted">—</span>
                  ) : (
                    <MemberGroupSelect profileId={m.id} currentGroupId={m.groupId} groups={groups} />
                  )}
                </td>
                <td className="px-5 py-3 text-muted">{new Date(m.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {team.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Users size={20} />
            </div>
            <p className="text-sm text-muted">No team members yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

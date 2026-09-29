import { LogOut } from "lucide-react";
import type { Role } from "@/lib/auth";

export function UserMenu({ email, role }: { email: string; role: Role }) {
  return (
    <div className="border-t border-border px-5 py-3">
      <span
        className={`mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
          role === "admin" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
        }`}
      >
        {role}
      </span>
      <form action="/api/auth/signout" method="post" className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted" title={email}>
          {email}
        </span>
        <button type="submit" className="flex items-center gap-1 text-xs text-muted hover:text-danger" title="Log out">
          <LogOut size={13} />
          Log out
        </button>
      </form>
    </div>
  );
}

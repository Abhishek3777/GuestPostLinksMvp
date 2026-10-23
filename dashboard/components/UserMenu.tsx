import { LogOut } from "lucide-react";
import type { Role } from "@/lib/auth";

export function UserMenu({ email, role, collapsed = false }: { email: string; role: Role; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-3.5 border-t border-border px-3 py-3">
        <form action="/api/auth/signout" method="post">
          <button type="submit" title={`Log out (${email})`} className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-danger">
            <LogOut size={13} />
          </button>
        </form>
      </div>
    );
  }

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

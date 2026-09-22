import { LogOut } from "lucide-react";

export function UserMenu({ email }: { email: string }) {
  return (
    <form action="/api/auth/signout" method="post" className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
      <span className="truncate text-xs text-muted" title={email}>
        {email}
      </span>
      <button type="submit" className="flex items-center gap-1 text-xs text-muted hover:text-danger" title="Log out">
        <LogOut size={13} />
        Log out
      </button>
    </form>
  );
}

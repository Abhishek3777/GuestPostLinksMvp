"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, [supabase]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (!email) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
      <span className="truncate text-xs text-muted" title={email}>
        {email}
      </span>
      <button onClick={handleLogout} className="flex items-center gap-1 text-xs text-muted hover:text-danger" title="Log out">
        <LogOut size={13} />
      </button>
    </div>
  );
}

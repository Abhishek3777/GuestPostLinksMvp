"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Link2, Menu, X } from "lucide-react";
import type { Role } from "@/lib/auth";
import { Sidebar } from "./Sidebar";

// Desktop: sidebar docked on the left. Phone: a slim top bar, and the same
// sidebar slides in over the page as a drawer.
export function AppShell({ email, role, children }: { email: string; role: Role; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer after navigating.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
            <Link2 size={14} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-text">Guest Post Links</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        >
          <Menu size={20} />
        </button>
      </header>

      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="absolute right-2 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text md:hidden"
        >
          <X size={18} />
        </button>
        <Sidebar email={email} role={role} />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

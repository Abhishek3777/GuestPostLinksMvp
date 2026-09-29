"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Link2, LayoutGrid, Plus, Radar, ShieldOff, Mail, Users } from "lucide-react";
import type { Role } from "@/lib/auth";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

const NAV = [
  { href: "/", label: "Campaigns", icon: LayoutGrid, exact: true },
  // Skips straight to Stage 3 — upload domains you already know, get their
  // contact info back, no crawling. Its own nav entry rather than a toggle
  // buried inside "New Campaign", since it's a genuinely different job.
  { href: "/campaigns/new?mode=direct", label: "Contact Lookup", icon: Mail, exact: true },
  // The standing list of sites to keep watching: switch sites on/off, run the
  // active ones, and get only what is new since the last run.
  { href: "/sites", label: "Sites to monitor", icon: Radar, exact: true },
  { href: "/do-not-contact", label: "Do Not Contact", icon: ShieldOff, exact: true },
];

// Admin-only: the Team page (member list + group management). Invite is
// still off within that page — accounts are seeded directly for now
// (dashboard/scripts/bootstrap-admin.mjs).
const ADMIN_NAV = [{ href: "/team", label: "Team", icon: Users, exact: true }];

export function Sidebar({ email, role }: { email: string; role: Role }) {
  const pathname = usePathname();
  const nav = role === "admin" ? [...NAV, ...ADMIN_NAV] : NAV;

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
      <Link href="/" className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
          <Link2 size={16} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-text">Guest Post Links</span>
      </Link>

      <nav className="flex flex-col gap-1 px-3">
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const hrefPath = href.split("?")[0];
          const active = exact ? pathname === hrefPath : pathname.startsWith(hrefPath);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pt-2">
        <Link
          href="/campaigns/new"
          className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus size={15} />
          New Campaign
        </Link>
      </div>

      <div className="mt-auto flex items-center justify-end px-5 py-4">
        <ThemeToggle />
      </div>
      <UserMenu email={email} role={role} />
    </aside>
  );
}

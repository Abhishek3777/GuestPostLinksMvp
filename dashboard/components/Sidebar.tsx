"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Link2, LayoutGrid, Plus, Radar, ShieldOff, Mail, Trophy, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Role } from "@/lib/auth";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { SettingsMenu } from "./SettingsMenu";

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
  // All-time leaderboard + the admin-curated "priority sites" list, with a
  // per-domain drill-down (backlinks/posts/filters/owner).
  { href: "/analytics", label: "Analytics", icon: Trophy, exact: false },
];

// Team and Costs live under Settings now, reached via the small gear icon
// next to the theme toggle (not a side-panel entry anymore) — moved off the
// row next to Log out, which sits at the very bottom of the sidebar and left
// too little room for the dropdown to open reliably.

const COLLAPSE_KEY = "sidebar-collapsed";

export function Sidebar({ email, role }: { email: string; role: Role }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Read the saved preference after mount only — reading localStorage during
  // the initial render would mismatch the server's always-expanded HTML.
  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside className={`flex h-dvh shrink-0 flex-col overflow-y-auto border-r border-border bg-surface transition-[width] duration-150 ${collapsed ? "w-16" : "w-60"}`}>
      <div className={`flex items-center gap-2 px-5 py-5 ${collapsed ? "justify-center px-0" : ""}`}>
        <Link href="/" className="flex items-center gap-2 overflow-hidden" title="Guest Post Links">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
            <Link2 size={16} />
          </div>
          {!collapsed && <span className="truncate text-sm font-semibold tracking-tight text-text">Guest Post Links</span>}
        </Link>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const hrefPath = href.split("?")[0];
          const active = exact ? pathname === hrefPath : pathname.startsWith(hrefPath);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${collapsed ? "justify-center px-0" : ""} ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pt-2">
        <Link
          href="/campaigns/new"
          title={collapsed ? "New Campaign" : undefined}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 ${collapsed ? "px-0" : ""}`}
        >
          <Plus size={15} className="shrink-0" />
          {!collapsed && "New Campaign"}
        </Link>
      </div>

      <div className={`mt-auto flex items-center px-3 py-4 ${collapsed ? "flex-col gap-2" : "justify-between px-5"}`}>
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "gap-1"}`}>
          {role === "admin" && <SettingsMenu />}
          <ThemeToggle />
        </div>
      </div>
      <UserMenu email={email} role={role} collapsed={collapsed} />
    </aside>
  );
}

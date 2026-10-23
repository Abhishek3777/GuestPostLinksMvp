"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Settings, Users2, Wallet } from "lucide-react";

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  // Rendered via a portal into document.body, positioned with `fixed` from
  // the button's real screen position — the sidebar has overflow-y-auto,
  // which (per the CSS spec) makes overflow-x compute to auto too the
  // moment either axis is non-"visible", so a plain absolutely-positioned
  // child here was silently clipped by the sidebar's own scroll boundary.
  // Confirmed live, 2026-10-23: Team/Costs existed in the DOM but were
  // visually hidden — this is why.
  //
  // Second bug, same symptom, different cause: this button sits at the very
  // bottom of the sidebar, so opening straight down (the first fix) pushed
  // the menu mostly or entirely below the visible viewport — "in the DOM"
  // but off-screen. Opens upward instead whenever there isn't room below.
  const MENU_HEIGHT = 84; // 2 items, ~34px each + padding
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const opensUp = window.innerHeight - r.bottom < MENU_HEIGHT + 12;
    setPos({ top: opensUp ? r.top - MENU_HEIGHT - 6 : r.bottom + 6, left: r.left });
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Settings size={14} />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
          >
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-text hover:bg-surface-2"
            >
              <Users2 size={13} /> Team
            </Link>
            <Link
              href="/settings?tab=costs"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-text hover:bg-surface-2"
            >
              <Wallet size={13} /> Costs
            </Link>
          </div>,
          document.body
        )}
    </>
  );
}

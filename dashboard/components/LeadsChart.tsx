"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Chart, registerables } from "chart.js";
import type { DayPoint } from "@/services/leads.service";

Chart.register(...registerables);

const COLORS = {
  light: { email: "#2a78d6", form: "#1baf7a", both: "#eb6834" },
  dark: { email: "#3987e5", form: "#199e70", both: "#d95926" },
};

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function shortDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function LeadsChart({ days }: { days: DayPoint[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!ref.current) return;
    const c = COLORS[resolvedTheme === "dark" ? "dark" : "light"];
    Chart.defaults.color = cssVar("--muted");
    const chart = new Chart(ref.current, {
      type: "bar",
      data: {
        labels: days.map((d) => shortDate(d.date)),
        datasets: [
          { label: "Email only", data: days.map((d) => d.emailOnly), backgroundColor: c.email, stack: "leads" },
          { label: "Form only", data: days.map((d) => d.formOnly), backgroundColor: c.form, stack: "leads" },
          { label: "Email and form", data: days.map((d) => d.both), backgroundColor: c.both, stack: "leads" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, color: cssVar("--text") } },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.dataset.label}: ${(item.parsed.y ?? 0).toLocaleString("en-US")}`,
              footer: (items) => `Total ${items.reduce((s, i) => s + (i.parsed.y ?? 0), 0).toLocaleString("en-US")}`,
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: cssVar("--border") },
            ticks: { callback: (v) => Number(v).toLocaleString("en-US") },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [days, resolvedTheme]);

  return (
    <div className="relative h-72">
      <canvas ref={ref} role="img" aria-label="Leads found per day, split by email only, form only, and both" />
    </div>
  );
}

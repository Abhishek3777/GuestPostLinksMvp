"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Chart, registerables, type ChartConfiguration } from "chart.js";
import { RefreshCw, Trash2 } from "lucide-react";
import type { CostData } from "@/services/costs.service";

Chart.register(...registerables);

const SERVICES = ["Railway", "Vercel", "Supabase", "2captcha", "CapSolver", "DataImpulse"] as const;
type Svc = (typeof SERVICES)[number];
const PREPAID: Svc[] = ["2captcha", "CapSolver", "DataImpulse"];

// Fixed categorical order (validated palette), one hue per service, both themes.
const COLORS: Record<"light" | "dark", Record<Svc, string>> = {
  light: { Railway: "#2a78d6", Vercel: "#eb6834", Supabase: "#1baf7a", "2captcha": "#eda100", CapSolver: "#e87ba4", DataImpulse: "#008300" },
  dark: { Railway: "#3987e5", Vercel: "#d95926", Supabase: "#199e70", "2captcha": "#c98500", CapSolver: "#d55181", DataImpulse: "#008300" },
};

type Currency = "USD" | "INR";
const makeMoney = (cur: Currency, rate: number) => (v: number) => {
  const x = cur === "INR" ? v * rate : v;
  const digits = cur === "INR" ? 0 : 2;
  return (
    (cur === "INR" ? "₹" : "$") +
    (Math.abs(x) < 0.005 ? 0 : x).toLocaleString(cur === "INR" ? "en-IN" : undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
};
type Money = ReturnType<typeof makeMoney>;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);


export function CostDashboard({ data }: { data: CostData }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const palette = COLORS[resolvedTheme === "dark" ? "dark" : "light"];

  const [range, setRange] = useState(30);
  const [on, setOn] = useState<Set<Svc>>(new Set(SERVICES));
  const [currency, setCurrency] = useState<Currency>("USD");
  const [pending, startTransition] = useTransition();
  const collecting = data.collecting || pending;
  const money = useMemo(() => makeMoney(currency, data.fx.rate), [currency, data.fx.rate]);
  const [form, setForm] = useState({ service: "2captcha", date: data.today, amount: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  // While a collection runs, poll the page data until it finishes.
  const running = data.collecting;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [running, router]);

  const active = useMemo(() => SERVICES.filter((s) => on.has(s)), [on]);

  const { dates, per, tot, rate, n, totalAll, rateAll } = useMemo(() => {
    const dates = data.dates.slice(-range);
    const per = {} as Record<Svc, number[]>;
    for (const s of SERVICES) {
      per[s] = dates.map((d) => data.cash[d]?.[s] ?? 0);
    }
    const n = dates.length;
    const tot = {} as Record<Svc, number>;
    const rate = {} as Record<Svc, number>;
    for (const s of SERVICES) {
      tot[s] = sum(per[s]);
      rate[s] = (tot[s] / n) * 30;
    }
    const totalAll = sum(active.map((s) => tot[s]));
    const rateAll = sum(active.map((s) => rate[s]));
    return { dates, per, tot, rate, n, totalAll, rateAll };
  }, [data, range, active]);

  const railwaySub = useMemo(() => {
    const sub: Record<string, number> = {};
    for (const d of dates) for (const [k, v] of Object.entries(data.railwaySub[d] ?? {})) sub[k] = (sub[k] ?? 0) + v;
    return Object.entries(sub).sort((a, z) => z[1] - a[1]);
  }, [data, dates]);

  const banners: { title: string; body: string }[] = [];
  const missing = PREPAID.filter((s) => !data.ledger.some((t) => t.service === s));
  if (missing.length)
    banners.push({ title: "Missing top-ups:", body: `${missing.join(", ")} have no ledger entries, so they show $0.` });
  for (const s of PREPAID) {
    const b = data.balances[s];
    if (b != null && b < 1) banners.push({ title: `${s} balance is ${money(b)}.`, body: "Solving will fail until it is topped up." });
  }
  if (data.dates.every((d) => !data.railwaySub[d]))
    banners.push({ title: "No Railway data yet.", body: "Click Refresh data (needs RAILWAY_API_TOKEN on this service). The first run backfills 35 days and takes a minute or two." });

  async function refresh() {
    startTransition(async () => {
      await fetch("/api/costs/refresh", { method: "POST" });
      router.refresh();
    });
  }

  async function addTopup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/costs/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: Number(form.amount) }),
    });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save");
      return;
    }
    setForm({ ...form, amount: "", note: "" });
    router.refresh();
  }

  async function removeTopup(id: string) {
    await fetch(`/api/costs/ledger/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const largest = [...active].sort((a, z) => rate[z] - rate[a])[0];
  const share = (s: Svc) => (rateAll ? Math.round((rate[s] / rateAll) * 100) : 0);

  const seg = (on: boolean) =>
    `px-3 py-1.5 text-sm transition-colors ${on ? "bg-accent text-white" : "bg-surface text-muted hover:text-text"}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Costs</h1>
          <p className="mt-1 text-sm text-muted">
            What the infrastructure costs per month. Balances last read {data.balancesAt ? new Date(data.balancesAt).toLocaleString() : "never"}.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={collecting}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw size={15} className={collecting ? "animate-spin" : ""} />
          {collecting ? "Collecting…" : "Refresh data"}
        </button>
      </div>

      {banners.map((b) => (
        <div key={b.title} className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-text">
          <b className="text-warning">{b.title}</b> {b.body}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Currency</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <button onClick={() => setCurrency("USD")} className={seg(currency === "USD")}>
              USD
            </button>
            <button
              onClick={() => setCurrency("INR")}
              className={seg(currency === "INR")}
              title={`1 USD = ₹${data.fx.rate.toFixed(2)} (${data.fx.source === "live" ? "live rate" : "fallback rate, live lookup failed"})`}
            >
              INR
            </button>
          </div>
          {currency === "INR" && (
            <span className="text-xs text-muted">
              1 USD = ₹{data.fx.rate.toFixed(2)}
              {data.fx.source === "fallback" ? " (fallback rate)" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Range</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {[7, 30, 60, 90].map((r) => (
              <button key={r} onClick={() => setRange(r)} className={seg(range === r)}>
                {r}d
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SERVICES.map((s) => (
            <button
              key={s}
              aria-pressed={on.has(s)}
              onClick={() => {
                const next = new Set(on);
                if (next.has(s)) next.delete(s);
                else next.add(s);
                setOn(next);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-opacity ${
                on.has(s) ? "border-muted/60 text-text" : "border-border text-muted opacity-60"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette[s] }} />
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          [money(rateAll), "Avg monthly cost (30-day equivalent)"],
          [money(totalAll), `Total paid over last ${n} days`],
          [money(rateAll / 30), "Avg per day"],
          [largest ? `${largest} · ${share(largest)}%` : "–", "Largest cost"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-2xl font-semibold tabular-nums text-text">{v}</div>
            <div className="mt-1 text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Daily cost by service" className="lg:col-span-2">
          <DailyChart dates={dates} per={per} active={active} palette={palette} money={money} />
        </Card>
        <Card title="Monthly run-rate by service">
          <RateChart rate={rate} active={active} palette={palette} money={money} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Cumulative spend" className="lg:col-span-2">
          <CumulativeChart dates={dates} per={per} active={active} money={money} />
        </Card>
        <Card title="Breakdown">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-1.5 text-left font-medium">Service</th>
                <th className="py-1.5 text-right font-medium">Range</th>
                <th className="py-1.5 text-right font-medium">Per month</th>
                <th className="py-1.5 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {active.map((s) => (
                <tr key={s} className="border-t border-border">
                  <td className="py-1.5">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: palette[s] }} />
                    {s}
                  </td>
                  <td className="py-1.5 text-right">{money(tot[s])}</td>
                  <td className="py-1.5 text-right">{money(rate[s])}</td>
                  <td className="py-1.5 text-right text-muted">{share(s)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-right">{money(totalAll)}</td>
                <td className="py-1.5 text-right">{money(rateAll)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {railwaySub.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Railway by service</summary>
              <table className="mt-2 w-full tabular-nums">
                <tbody>
                  {railwaySub.map(([k, v]) => (
                    <tr key={k} className="border-t border-border">
                      <td className="py-1.5">{k}</td>
                      <td className="py-1.5 text-right">{money(v)}</td>
                      <td className="py-1.5 text-right text-muted">{money((v / n) * 30)}/mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </Card>
      </div>

      <Card title="Prepaid balances & top-up ledger">
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {PREPAID.map((s) => {
            const b = data.balances[s];
            return (
              <span key={s}>
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: palette[s] }} />
                {s}:{" "}
                {b == null ? (
                  <span className="text-muted">no API</span>
                ) : (
                  <b className={b < 1 ? "text-danger" : ""}>{money(b)}</b>
                )}
              </span>
            );
          })}
        </div>

        <form onSubmit={addTopup} className="mb-3 flex flex-wrap gap-2">
          <select
            value={form.service}
            onChange={(e) => setForm({ ...form, service: e.target.value })}
            className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm"
          >
            {PREPAID.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm" />
          <input type="number" required min="0.01" step="0.01" placeholder="USD" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-24 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm" />
          <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="min-w-40 flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm" />
          <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Add top-up</button>
        </form>
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1.5 text-left font-medium">Service</th>
              <th className="py-1.5 text-left font-medium">Date</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
              <th className="py-1.5 pl-4 text-left font-medium">Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.ledger.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="py-1.5">{t.service}</td>
                <td className="py-1.5">{t.date}</td>
                <td className="py-1.5 text-right">{money(t.amount)}</td>
                <td className="py-1.5 pl-4 text-muted">{t.note}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => removeTopup(t.id)} aria-label="Delete top-up" className="text-muted hover:text-danger">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {data.detected.map((t, i) => (
              <tr key={`d${i}`} className="border-t border-border text-muted">
                <td className="py-1.5">{t.service}</td>
                <td className="py-1.5">{t.date}</td>
                <td className="py-1.5 text-right">{money(t.amount)}</td>
                <td className="py-1.5 pl-4">detected from balance increase</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        {data.ledger.length === 0 && <p className="py-3 text-sm text-muted">No top-ups recorded yet.</p>}
        <p className="mt-3 text-xs text-muted">
          Amounts are what left the bank: each top-up counts on the day it was paid. Railway is real usage priced per day; Vercel and Supabase are flat monthly plans spread across the month. DataImpulse has no usage API, so it relies on the top-ups entered here.
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

// ---- charts -------------------------------------------------------------

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function useChart(build: () => ChartConfiguration, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    Chart.defaults.color = cssVar("--muted");
    const chart = new Chart(ref.current, build());
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, resolvedTheme]);
  return ref;
}

type Palette = Record<Svc, string>;

function DailyChart({ dates, per, active, palette, money }: { dates: string[]; per: Record<Svc, number[]>; active: Svc[]; palette: Palette; money: Money }) {
  const ref = useChart(
    () => ({
      type: "bar",
      data: {
        labels: dates.map((d) => d.slice(5)),
        datasets: active.map((s) => ({ label: s, data: per[s], backgroundColor: palette[s], borderColor: cssVar("--surface"), borderWidth: 1, stack: "a" })),
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
              label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y ?? 0)}`,
              footer: (items) => "Total " + money(sum(items.map((i) => i.parsed.y ?? 0))),
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { stacked: true, grid: { color: cssVar("--border") }, ticks: { callback: (v: string | number) => money(Number(v)) } },
        },
      },
    }),
    [dates, per, active, palette, money],
  );
  return (
    <div className="relative h-72">
      <canvas ref={ref} role="img" aria-label="Daily cost stacked by service" />
    </div>
  );
}

function RateChart({ rate, active, palette, money }: { rate: Record<Svc, number>; active: Svc[]; palette: Palette; money: Money }) {
  const sorted = [...active].sort((a, z) => rate[z] - rate[a]);
  const ref = useChart(
    () => ({
      type: "bar",
      data: { labels: sorted, datasets: [{ label: "Per month", data: sorted.map((s) => rate[s]), backgroundColor: sorted.map((s) => palette[s]), borderRadius: 4 }] },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.x ?? 0)} / month` } } },
        scales: { x: { grid: { color: cssVar("--border") }, ticks: { callback: (v: string | number) => money(Number(v)) } }, y: { grid: { display: false } } },
      },
    }),
    [rate, active, palette, money],
  );
  return (
    <div className="relative h-72">
      <canvas ref={ref} role="img" aria-label="Monthly run-rate per service" />
    </div>
  );
}

function CumulativeChart({ dates, per, active, money }: { dates: string[]; per: Record<Svc, number[]>; active: Svc[]; money: Money }) {
  const ref = useChart(() => {
    let run = 0;
    const cum = dates.map((_, i) => (run += sum(active.map((s) => per[s][i]))));
    return {
      type: "line",
      data: { labels: dates.map((d) => d.slice(5)), datasets: [{ label: "Cumulative", data: cum, borderColor: cssVar("--accent"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.15 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.y ?? 0)}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: cssVar("--border") }, ticks: { callback: (v: string | number) => money(Number(v)) } } },
      },
    };
  }, [dates, per, active, money]);
  return (
    <div className="relative h-60">
      <canvas ref={ref} role="img" aria-label="Cumulative spend over time" />
    </div>
  );
}

import { db } from "@/lib/db";
import { costBalanceSnapshots, costRailwayDaily, costRailwayReal, costVercelDaily } from "@/lib/schema";
import { sql } from "drizzle-orm";

// Pulls cost inputs into the DB: priced Railway usage per day per service,
// and the 2captcha / CapSolver balances. Needs on the dashboard service:
//   RAILWAY_API_TOKEN     — an *account* token (Railway → Account Settings →
//                           Tokens, "No workspace"), so it can read every workspace
//   TWO_CAPTCHA_API_KEY, CAPSOLVER_API_KEY
//   VERCEL_API_TOKEN      — token scoped to the Vercel team (optional VERCEL_TEAM_ID,
//                           default "acg-digital"); without it Vercel stays a flat $20
// Anything missing is skipped and reported, never thrown.

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";
// Railway workspaces whose usage counts toward the bill.
const WORKSPACE_IDS = (
  process.env.RAILWAY_WORKSPACE_IDS ?? "26276fab-8b77-470e-8d81-51c6d4ff9674,91140ce5-cdb6-4822-b919-48a174a2dbad"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Railway's published unit prices (usage is reported as vCPU-min, GB-min, GB).
const RATES = { CPU_USAGE: 0.000463, MEMORY_USAGE_GB: 0.000231, NETWORK_TX_GB: 0.05, DISK_USAGE_GB: 0.0000035 } as const;
type Measurement = keyof typeof RATES;
const MEASUREMENTS = Object.keys(RATES) as Measurement[];

const BACKFILL_DAYS = 95;
const REFRESH_RECENT_DAYS = 3;

async function railway<T>(query: string, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(RAILWAY_GQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}` },
        body: JSON.stringify({ query }),
      });
      const json = (await res.json()) as { data?: T; errors?: unknown };
      if (json.errors || !json.data) throw new Error(JSON.stringify(json.errors ?? "empty response"));
      return json.data;
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Only these two Railway projects are ours to track — "helloteam-star's
// Projects" workspace also holds proud-blessing and laudable-expression
// (someone else's), and "Kumar Abhishek's Projects" holds guest-post-links
// separately; WORKSPACE_IDS pulls usage at the whole-workspace level (that's
// the only granularity Railway's usage query offers), so this filters back
// down to just the two real projects after the fact. Confirmed live,
// 2026-10-27: this is why the dashboard's own Railway figure didn't match
// Railway's own account-wide usage page — they were never scoped the same.
const TRACKED_PROJECT_NAMES = new Set(["ample-serenity", "ingenious-wonder"]);

async function collectRailway(): Promise<string> {
  if (!process.env.RAILWAY_API_TOKEN) return "railway: RAILWAY_API_TOKEN not set";

  // service id -> "project / service" label, only for tracked projects —
  // everything else's usage gets discarded below (no entry in `names` and no
  // entry in `allowedServiceIds`).
  const names: Record<string, string> = {};
  const allowedServiceIds = new Set<string>();
  for (const w of WORKSPACE_IDS) {
    const d = await railway<{
      workspace: { projects: { edges: { node: { name: string; services: { edges: { node: { id: string; name: string } }[] } } }[] } };
    }>(`query { workspace(workspaceId:"${w}") { projects { edges { node { name services { edges { node { id name } } } } } } } }`);
    for (const { node: p } of d.workspace.projects.edges) {
      if (!TRACKED_PROJECT_NAMES.has(p.name)) continue;
      for (const { node: s } of p.services.edges) {
        names[s.id] = `${p.name} / ${s.name}`;
        allowedServiceIds.add(s.id);
      }
    }
  }

  const existing = new Set(
    (await db.selectDistinct({ day: costRailwayDaily.day }).from(costRailwayDaily)).map((r) => r.day),
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let written = 0;
  for (let i = BACKFILL_DAYS; i >= 0; i--) {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - i);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const day = ymd(start);
    if (i >= REFRESH_RECENT_DAYS && existing.has(day)) continue;

    const bucket: Record<string, number> = {};
    for (const w of WORKSPACE_IDS) {
      const d = await railway<{ usage: { measurement: Measurement; value: number; tags: { serviceId: string | null } }[] }>(
        `query { usage(workspaceId:"${w}", measurements:[${MEASUREMENTS.join(",")}], groupBy:[SERVICE_ID], startDate:"${iso(start)}", endDate:"${iso(end)}") { measurement value tags { serviceId } } }`,
      );
      for (const u of d.usage) {
        const sid = u.tags?.serviceId;
        if (!sid || !allowedServiceIds.has(sid)) continue; // not one of our two tracked projects
        const label = names[sid];
        bucket[label] = (bucket[label] ?? 0) + RATES[u.measurement] * u.value;
      }
    }
    const rows = Object.entries(bucket).map(([label, cost]) => ({ day, label, cost }));
    if (rows.length) {
      await db
        .insert(costRailwayDaily)
        .values(rows)
        .onConflictDoUpdate({ target: [costRailwayDaily.day, costRailwayDaily.label], set: { cost: sql`excluded.cost` } });
      written += rows.length;
    }
  }
  return `railway: ${written} rows`;
}

// Railway's OWN real current-period total, via the CLI's `usage projects`
// command — not available through the public GraphQL API (confirmed live,
// 2026-10-27: searched the full public schema, no cost/dollar field exists
// there, only the raw usage metrics collectRailway above already uses).
// RAILWAY_API_TOKEN (already required above) authenticates this the same
// non-interactive way Railway's docs describe for CI/automation use —
// worth a one-time manual confirmation after this first deploys, since it
// couldn't be verified here without reading the real token value.
async function collectRailwayReal(): Promise<string> {
  if (!process.env.RAILWAY_API_TOKEN) return "railway-real: RAILWAY_API_TOKEN not set";
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // Resolved via require.resolve, not "npx railway" — npx's own PATH/shim
  // resolution is platform-dependent (confirmed live, 2026-10-27: "spawn npx
  // ENOENT" on Windows, since execFile doesn't go through a shell to resolve
  // npx.cmd). Running the package's own entry file with the same Node
  // runtime sidesteps that entirely, on any OS.
  const railwayBin = require.resolve("@railway/cli/bin/railway.js");

  let written = 0;
  const errors: string[] = [];
  for (const w of WORKSPACE_IDS) {
    try {
      const { stdout } = await run(process.execPath, [railwayBin, "usage", "projects", "--workspace", w, "--period", "current", "--json"], {
        env: { ...process.env },
        timeout: 30_000,
      });
      const data = JSON.parse(stdout) as {
        billingPeriod: { start: string };
        projects: { id: string; name: string; currentUsageDollars: number }[];
      };
      const periodStart = data.billingPeriod.start.slice(0, 10);
      const rows = data.projects
        .filter((p) => TRACKED_PROJECT_NAMES.has(p.name))
        .map((p) => ({ periodStart, projectId: p.id, projectName: p.name, usageDollars: p.currentUsageDollars }));
      if (rows.length) {
        await db
          .insert(costRailwayReal)
          .values(rows)
          .onConflictDoUpdate({
            target: [costRailwayReal.periodStart, costRailwayReal.projectId],
            set: { usageDollars: sql`excluded.usage_dollars`, collectedAt: sql`now()` },
          });
        written += rows.length;
      }
    } catch (err) {
      const e = err as { stderr?: unknown; stdout?: unknown; code?: unknown; signal?: unknown };
      const detail = [e?.stderr, e?.stdout].map(String).filter((s) => s && s !== "undefined").join(" | ");
      errors.push(`${w}: code=${e?.code} signal=${e?.signal} ${detail || (err instanceof Error ? err.message : String(err))}`);
    }
  }
  return errors.length ? `railway-real: ${written} rows, errors: ${errors.join("; ")}` : `railway-real: ${written} rows`;
}

// ---------- Vercel ----------
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID ?? "acg-digital";
const VERCEL_BACKFILL_DAYS = 95;
const VERCEL_RECENT_DAYS = 4;

// Billing API returns one JSONL row per usage line (tens of thousands a month),
// so aggregate to day + item as we go and only ask for short windows.
async function vercelCharges(from: Date, to: Date): Promise<Map<string, number>> {
  const url = `https://api.vercel.com/v1/billing/charges?teamId=${encodeURIComponent(VERCEL_TEAM)}&from=${from.toISOString()}&to=${to.toISOString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Vercel billing API ${res.status}`);
  const out = new Map<string, number>();
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { BilledCost?: number; ChargePeriodStart: string; ServiceName: string };
    const cost = Number(r.BilledCost ?? 0);
    if (!cost) continue;
    const key = `${r.ChargePeriodStart.slice(0, 10)}|${r.ServiceName}`;
    out.set(key, (out.get(key) ?? 0) + cost);
  }
  return out;
}

async function collectVercel(): Promise<string> {
  if (!process.env.VERCEL_API_TOKEN) return "vercel: VERCEL_API_TOKEN not set (using flat $20)";
  const have = await db.select({ day: costVercelDaily.day }).from(costVercelDaily).limit(1);
  const days = have.length ? VERCEL_RECENT_DAYS : VERCEL_BACKFILL_DAYS;

  const end = new Date();
  let written = 0;
  // 30-day chunks, newest first, so a big backfill never asks for one huge response.
  for (let covered = 0; covered < days; covered += 30) {
    const to = new Date(end.getTime() - covered * 86400000);
    const from = new Date(end.getTime() - Math.min(covered + 30, days) * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const agg = await vercelCharges(from, to);
    const rows = [...agg].map(([k, cost]) => {
      const [day, label] = k.split("|");
      return { day, label, cost };
    });
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(costVercelDaily)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({ target: [costVercelDaily.day, costVercelDaily.label], set: { cost: sql`excluded.cost` } });
    }
    written += rows.length;
  }
  return `vercel: ${written} rows`;
}

async function collectBalances(): Promise<string> {
  const rows: { service: string; balance: number }[] = [];
  const notes: string[] = [];

  if (process.env.TWO_CAPTCHA_API_KEY) {
    try {
      const res = await fetch(`https://2captcha.com/res.php?key=${process.env.TWO_CAPTCHA_API_KEY}&action=getbalance&json=1`);
      const j = (await res.json()) as { status: number; request: string };
      const balance = parseFloat(j.request);
      if (j.status === 1 && Number.isFinite(balance)) rows.push({ service: "2captcha", balance });
      else notes.push("2captcha rejected the key");
    } catch {
      notes.push("2captcha unreachable");
    }
  } else notes.push("TWO_CAPTCHA_API_KEY not set");

  if (process.env.CAPSOLVER_API_KEY) {
    try {
      const res = await fetch("https://api.capsolver.com/getBalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: process.env.CAPSOLVER_API_KEY }),
      });
      const j = (await res.json()) as { errorId: number; balance: number };
      if (j.errorId === 0) rows.push({ service: "CapSolver", balance: j.balance });
      else notes.push("CapSolver rejected the key");
    } catch {
      notes.push("CapSolver unreachable");
    }
  } else notes.push("CAPSOLVER_API_KEY not set");

  if (rows.length) await db.insert(costBalanceSnapshots).values(rows);
  return `balances: ${rows.map((r) => `${r.service}=${r.balance}`).join(", ") || "none"}${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

let running: Promise<string[]> | null = null;

// One collection at a time per process; concurrent callers share the run.
export function collectCosts(): Promise<string[]> {
  if (running) return running;
  running = (async () => {
    const out: string[] = [];
    for (const step of [collectBalances, collectRailway, collectRailwayReal, collectVercel]) {
      try {
        out.push(await step());
      } catch (e) {
        out.push(`${step.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log("[costs]", out.join(" | "));
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function isCollecting(): boolean {
  return running !== null;
}

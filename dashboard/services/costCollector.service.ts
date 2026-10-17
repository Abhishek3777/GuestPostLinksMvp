import { db } from "@/lib/db";
import { costBalanceSnapshots, costRailwayDaily } from "@/lib/schema";
import { sql } from "drizzle-orm";

// Pulls cost inputs into the DB: priced Railway usage per day per service,
// and the 2captcha / CapSolver balances. Needs on the dashboard service:
//   RAILWAY_API_TOKEN     — an *account* token (Railway → Account Settings →
//                           Tokens, "No workspace"), so it can read every workspace
//   TWO_CAPTCHA_API_KEY, CAPSOLVER_API_KEY
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

async function collectRailway(): Promise<string> {
  if (!process.env.RAILWAY_API_TOKEN) return "railway: RAILWAY_API_TOKEN not set";

  // service id -> "project / service" label
  const names: Record<string, string> = {};
  for (const w of WORKSPACE_IDS) {
    const d = await railway<{
      workspace: { projects: { edges: { node: { name: string; services: { edges: { node: { id: string; name: string } }[] } } }[] } };
    }>(`query { workspace(workspaceId:"${w}") { projects { edges { node { name services { edges { node { id name } } } } } } } }`);
    for (const { node: p } of d.workspace.projects.edges)
      for (const { node: s } of p.services.edges) names[s.id] = `${p.name} / ${s.name}`;
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
        const label = (sid && names[sid]) || sid || "unknown";
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
    for (const step of [collectBalances, collectRailway]) {
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
